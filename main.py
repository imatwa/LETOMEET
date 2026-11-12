from flask import Flask, jsonify, render_template, request, session
from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import generate_password_hash, check_password_hash
from email.message import EmailMessage
from datetime import datetime, timezone, timedelta
import smtplib
import secrets
import os
import uuid
import re
from PIL import Image, UnidentifiedImageError
from flask import send_from_directory, send_file
from sqlalchemy.exc import SQLAlchemyError
import io
from PIL import ImageOps

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = int(4.25 * 1024 * 1024)

app.config["SECRET_KEY"] = os.environ.get(
    "SECRET_KEY",
    secrets.token_hex(32)
)

if not app.config["SECRET_KEY"]:
    raise RuntimeError("SECRET_KEY is not configured")

# Secure environment check
database_url = os.environ.get('DATABASE_URL')

if database_url:
    if database_url.startswith("postgres://"):
        database_url = database_url.replace("postgres://", "postgresql://", 1)
    app.config['SQLALCHEMY_DATABASE_URI'] = database_url
else:
    app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///school.db'

app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

# Add engine options here to prevent Vercel connection exhaustion
app.config['SQLALCHEMY_ENGINE_OPTIONS'] = {
    "pool_pre_ping": True,
    "pool_recycle": 300,
}

db = SQLAlchemy(app)

app.config.update(SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE="Lax", SESSION_COOKIE_SECURE=os.environ.get("APP_ENV") == "production")
if os.environ.get("APP_ENV") == "production" and not os.environ.get("SECRET_KEY"):
    raise RuntimeError("Set SECRET_KEY in production")
UPLOAD_FOLDER = os.path.abspath(os.environ.get("UPLOAD_FOLDER", os.path.join(app.instance_path, "uploads")))
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "")
# -----------------------------
# Data model
# -----------------------------


class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)

    username = db.Column(
        db.String(80),
        nullable=False
    )

    email = db.Column(
        db.String(150),
        unique=True,
        nullable=False
    )

    role = db.Column(
        db.String(20),
        nullable=False,
        default="user"
    )

    created_at = db.Column(
        db.DateTime,
        default=lambda: datetime.now(timezone.utc)
    )

    def to_dict(self):
        return {
            "id": self.id,
            "username": self.username,
            "email": self.email,
            "role": self.role
        }


class AuthCode(db.Model):
    id = db.Column(db.Integer, primary_key=True)

    email = db.Column(
        db.String(150),
        nullable=False
    )

    username = db.Column(
        db.String(80),
        nullable=True
    )

    purpose = db.Column(
        db.String(20),
        nullable=False
    )

    code_hash = db.Column(
        db.String(255),
        nullable=False
    )

    expires_at = db.Column(
        db.DateTime,
        nullable=False
    )

    created_at = db.Column(
        db.DateTime,
        default=lambda: datetime.now(timezone.utc)
    )


class Event(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    creator_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=True)
    title = db.Column(db.String(150), nullable=False)
    summary = db.Column(db.String(300), nullable=True)
    description = db.Column(db.Text, nullable=False)
    activity = db.Column(db.String(100), nullable=False)
    type = db.Column(db.String(100), nullable=False)
    duration = db.Column(db.String(50), nullable=False)
    place = db.Column(db.String(100), nullable=False)
    room = db.Column(db.String(100), nullable=False)
    date = db.Column(db.String(20), nullable=False)
    time = db.Column(db.String(10), nullable=False)
    end = db.Column(db.String(10), nullable=False)
    regular = db.Column(db.Boolean, default=False)
    organizer = db.Column(db.String(100), nullable=False)
    count = db.Column(db.Integer, default=0)
    chat = db.Column(db.String(200), default="")
    contact = db.Column(db.String(200), default="")
    status = db.Column(db.String(20), nullable=False, default="pending")
    moderation_comment = db.Column(db.Text, nullable=True)
    image_url = db.Column(db.String(500), nullable=True)
    card_color = db.Column(db.String(20), nullable=False, default="cream")
    card_emoji = db.Column(db.String(20), nullable=True)
    tagline = db.Column(db.String(80), nullable=True)

    def to_dict(self):
        """Converts the SQL row into a regular dictionary for the API responses"""
        return {
            "id": self.id,
            "title": self.title,
            "creator_id": self.creator_id,
            "summary": self.summary,
            "description": self.description,
            "activity": self.activity,
            "type": self.type,
            "duration": self.duration,
            "place": self.place,
            "room": self.room,
            "date": self.date,
            "time": self.time,
            "end": self.end,
            "regular": self.regular,
            "organizer": self.organizer,
            "count": self.count,
            "chat": self.chat,
            "contact": self.contact,
            "status": self.status,
            "moderation_comment": self.moderation_comment,
            "image_url": self.image_url,
            "card_color": self.card_color,
            "card_emoji": self.card_emoji,
            "tagline": self.tagline
        }


class Registration(db.Model):
    id = db.Column(db.Integer, primary_key=True)

    user_id = db.Column(
        db.Integer,
        db.ForeignKey("user.id"),
        nullable=False
    )

    event_id = db.Column(
        db.Integer,
        db.ForeignKey("event.id"),
        nullable=False
    )

    created_at = db.Column(
        db.DateTime,
        default=lambda: datetime.now(timezone.utc)
    )


# Automatically build database tables when the app runs
ALLOWED_DOMAINS = (
    "@student.letovo.ru",
    "@letovo.ru"
)

CODE_LIFETIME_MINUTES = 10


def normalize_email(email):
    return str(email or "").strip().lower()


def valid_letovo_email(email):
    return len(email) <= 150 and bool(re.fullmatch(r"[a-z0-9.!#$%&\'*+/=?^_`{|}~-]+@(student\.letovo\.ru|letovo\.ru)", email))


def ensure_admin():
    admin_email = normalize_email(ADMIN_EMAIL)

    if not admin_email:
        return

    admin_name = os.environ.get(
        "ADMIN_NAME",
        "LETOMEET Admin"
    )

    user = User.query.filter_by(
        email=admin_email
    ).first()

    if not user:
        user = User(
            username=admin_name,
            email=admin_email,
            role="admin"
        )

        db.session.add(user)

    else:
        user.role = "admin"

    db.session.commit()


class SecurityCounter(db.Model):
    key = db.Column(db.String(240), primary_key=True)
    count = db.Column(db.Integer, default=0)
    reset = db.Column(db.DateTime, nullable=False)

class EventImage(db.Model):
    id = db.Column(db.String(32), primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    data = db.Column(db.LargeBinary, nullable=False)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))

class Comment(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    event_id = db.Column(db.Integer, db.ForeignKey("event.id"), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    body = db.Column(db.String(2000), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

with app.app_context():
    db.create_all()
    ensure_admin()


def create_code():
    return f"{secrets.randbelow(1000000):06d}"


def send_email_code(email, code, purpose):
    smtp_host = os.environ.get("SMTP_HOST")
    smtp_port = int(os.environ.get("SMTP_PORT", "587"))
    smtp_user = os.environ.get("SMTP_USER")
    smtp_password = os.environ.get("SMTP_PASSWORD")
    email_from = os.environ.get("EMAIL_FROM", smtp_user)

    if not smtp_host or not smtp_user or not smtp_password:
        if os.environ.get("MAIL_MODE") == "console" and os.environ.get("APP_ENV") != "production":
            print(f"[LETOMEET DEV] Code for {email}: {code}")
            return True
        raise RuntimeError("SMTP is not configured")

    message = EmailMessage()

    message["Subject"] = (
        "Код для LETOMEET"
        if purpose == "login"
        else "Код регистрации в LETOMEET"
    )

    message["From"] = email_from
    message["To"] = email

    message.set_content(
        f"""Здравствуйте!

    Ваш код для LETOMEET: {code}

    Код действует {CODE_LIFETIME_MINUTES} минут.

    Если вы не запрашивали этот код, просто проигнорируйте это письмо.

    LETOMEET
    """
    )

    html = f"""
    <!DOCTYPE html>
    <html lang="ru">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>

    <body style="
        margin: 0;
        padding: 0;
        background-color: #f5f5f5;
        font-family: Arial, Helvetica, sans-serif;
    ">

        <div style="
            max-width: 560px;
            margin: 40px auto;
            background: #ffffff;
            border-radius: 16px;
            overflow: hidden;
            border: 1px solid #e5e5e5;
        ">

            <div style="
                padding: 28px 32px;
                border-bottom: 1px solid #eeeeee;
            ">
                <div style="
                    font-size: 24px;
                    font-weight: 700;
                    letter-spacing: -0.5px;
                ">
                    LETOMEET
                </div>
            </div>

            <div style="
                padding: 40px 32px;
                text-align: center;
            ">

                <h1 style="
                    margin: 0 0 12px;
                    font-size: 24px;
                    color: #222222;
                ">
                    Код подтверждения
                </h1>

                <p style="
                    margin: 0 0 28px;
                    font-size: 15px;
                    line-height: 1.5;
                    color: #666666;
                ">
                    Используйте этот код для продолжения работы с LETOMEET.
                </p>

                <div style="
                    display: inline-block;
                    padding: 16px 28px;
                    background: #f7f3df;
                    border-radius: 12px;
                    font-size: 32px;
                    font-weight: 700;
                    letter-spacing: 6px;
                    color: #222222;
                ">
                    {code}
                </div>

                <p style="
                    margin: 24px 0 0;
                    font-size: 14px;
                    color: #777777;
                ">
                    Код действует {CODE_LIFETIME_MINUTES} минут.
                </p>

            </div>

            <div style="
                padding: 24px 32px;
                background: #fafafa;
                border-top: 1px solid #eeeeee;
                font-size: 13px;
                line-height: 1.5;
                color: #888888;
            ">
                Если вы не запрашивали этот код, просто проигнорируйте это письмо.
                <br><br>
                LETOMEET — каталог событий школы.
            </div>

        </div>

    </body>
    </html>
    """

    message.add_alternative(html, subtype="html")

    with smtplib.SMTP(smtp_host, smtp_port, timeout=15) as smtp:
        smtp.starttls()
        smtp.login(smtp_user, smtp_password)
        smtp.send_message(message)

    return True


def current_user():
    user_id = session.get("user_id")

    if not user_id:
        return None

    return db.session.get(User, user_id)


def admin_required():
    user = current_user()

    if not user:
        return None, (
            jsonify({"error": "Необходимо войти"}),
            401
        )

    if user.role != "admin":
        return None, (
            jsonify({"error": "Доступ запрещён"}),
            403
        )

    return user, None

FILTER_GROUPS = [
    {
        "key": "activity",
        "label": "Род деятельности",
        "options": ["Компьютерные игры", "Настольные игры", "Рисование", "Прогулка", "Спорт", "Просмотр", "Разговоры", "Музыка"],
    },
    {
        "key": "type",
        "label": "Тип события",
        "options": ["Просто сбор", "Турнир", "Клуб"],
    },
    {
        "key": "duration",
        "label": "Длительность",
        "options": ["До 20 минут", "Менее часа", "Около часа", "Пара часов", "Более 5 часов"],
    },
    {
        "key": "place",
        "label": "Место",
        "options": ["Дом пансиона", "Блок Science", "Учебный блок 2 этажа", "Блок Arts", "Фикусная", "Желтые диваны", "Синие диваны", "Учебный блок 3 этажа", "Главная сцена", "Малая сцена", "Блок иностранных языков", "Большой академ", "Улица", "Ресепшен", "Библиотека"]
    },
]

# -----------------------------
# Helpers
# -----------------------------

def filter_events(query_base, args):
    """Server-side filtering translated to SQL queries."""
    for group in FILTER_GROUPS:
        selected = args.getlist(group["key"])
        if selected:
            query_base = query_base.filter(getattr(Event, group["key"]).in_(selected))

    date_from = args.get("from", "")
    date_to = args.get("to", "")

    if date_from:
        query_base = query_base.filter(Event.date >= date_from)
    if date_to:
        query_base = query_base.filter(Event.date <= date_to)

    return query_base.order_by(Event.date, Event.time).all()


# -----------------------------
# Pages (FIX #2: Cleaned up overlapped routing decorators)
# -----------------------------

@app.before_request
def protect_requests():
    if request.method not in {"GET", "HEAD", "OPTIONS"}:
        origin = request.headers.get("Origin")
        if origin and origin != request.host_url.rstrip("/"):
            return jsonify(error="Недопустимый источник запроса"), 403
    if request.path.startswith("/api/auth/") and request.method == "POST" and request.path.endswith(("/request", "/verify")):
        data = request.get_json(silent=True) or {}
        email = normalize_email(data.get("email"))
        verify = request.path.endswith("/verify")
        now = datetime.utcnow()
        keys = [("ip:" + str(request.remote_addr), 50, 600),
                (("verify:" if verify else "send:") + email, 5 if verify else 1, 600 if verify else 60)]
        for key, limit, seconds in keys:
            row = db.session.get(SecurityCounter, key)
            if not row:
                row = SecurityCounter(key=key, count=0, reset=now + timedelta(seconds=seconds))
                db.session.add(row)
            if row.reset < now:
                row.count = 0
                row.reset = now + timedelta(seconds=seconds)
            if row.count >= limit:
                db.session.commit()
                return jsonify(error="Слишком много попыток. Попробуйте позже."), 429
            row.count += 1
        if not verify:
            AuthCode.query.filter_by(email=email).delete()
        db.session.commit()

@app.errorhandler(413)
def upload_too_large(error):
    return jsonify(error="Фото должно быть не больше 4 МБ. Попробуйте уменьшить файл."), 413

@app.get("/media/<filename>")
def media(filename):
    if re.fullmatch(r"[a-f0-9]{32}\.jpg", filename):
        stored = db.session.get(EventImage, filename[:-4])
        if stored:
            response = send_file(io.BytesIO(stored.data), mimetype="image/jpeg", download_name=filename,
                                 max_age=86400, etag=stored.id, conditional=True)
            response.headers["X-Content-Type-Options"] = "nosniff"
            return response
    # Keep pre-update local photo URLs working on persistent servers.
    return send_from_directory(UPLOAD_FOLDER, filename)

@app.route("/api/events/<int:event_id>/comments", methods=["GET", "POST"])
def event_comments(event_id):
    event = db.get_or_404(Event, event_id)
    user = current_user()
    if event.status != "approved":
        return jsonify(error="Событие не опубликовано"), 404
    if request.method == "POST":
        if not user:
            return jsonify(error="Необходимо войти"), 401
        body = str((request.get_json(silent=True) or {}).get("body", "")).strip()
        if not 1 <= len(body) <= 2000:
            return jsonify(error="Комментарий: от 1 до 2000 символов"), 400
        recent = Comment.query.filter(Comment.user_id == user.id, Comment.created_at > datetime.utcnow() - timedelta(seconds=10)).first()
        if recent:
            return jsonify(error="Подождите 10 секунд"), 429
        db.session.add(Comment(event_id=event_id, user_id=user.id, body=body))
        db.session.commit()
    rows = Comment.query.filter_by(event_id=event_id).order_by(Comment.id.desc()).limit(100).all()
    return jsonify([dict(id=c.id, body=c.body, author=db.session.get(User, c.user_id).username,
                         created_at=c.created_at.isoformat()+"Z", can_delete=bool(user and (user.id == c.user_id or user.role == "admin"))) for c in rows])

@app.delete("/api/comments/<int:comment_id>")
def delete_comment(comment_id):
    user = current_user()
    comment = db.get_or_404(Comment, comment_id)
    if not user or (user.id != comment.user_id and user.role != "admin"):
        return jsonify(error="Доступ запрещён"), 403
    db.session.delete(comment)
    db.session.commit()
    return jsonify(ok=True)

@app.get('/favicon.ico')
def favicon():
    return '', 204

@app.get("/")
@app.get("/events")
@app.get("/events/<int:event_id>")
@app.get("/map")
def index_pages(event_id=None):
    return render_template("index.html")


# -----------------------------
# API
# -----------------------------

@app.get("/api/events")
def api_events():
    filtered = filter_events(
        Event.query.filter_by(status="approved"),
        request.args
    )
    return jsonify([event.to_dict() for event in filtered])

@app.get("/api/events/<int:event_id>")
def api_event(event_id):
    event = Event.query.get_or_404(event_id)

    if event.status != "approved":
        user = current_user()

        if not user or (user.role != "admin" and event.creator_id != user.id):
            return jsonify({"error": "Мероприятие не опубликовано"}), 404

    return jsonify(event.to_dict())

@app.get("/api/filter-groups")
def api_filter_groups():
    return jsonify(FILTER_GROUPS)

@app.route("/api/events/<int:event_id>/join", methods=["POST"])
def join_event(event_id):
    # Проверяем, вошёл ли пользователь
    user_id = session.get("user_id")

    if not user_id:
        return jsonify({"error": "Необходимо войти в аккаунт"}), 401

    # Проверяем, существует ли мероприятие
    event = Event.query.get(event_id)

    if not event:
        return jsonify({"error": "Мероприятие не найдено"}), 404

    if event.status != "approved":
        return jsonify(error="Событие не опубликовано"), 404

    # Проверяем, не записан ли пользователь уже
    existing_registration = Registration.query.filter_by(
        user_id=user_id,
        event_id=event_id
    ).first()

    if existing_registration:
        return jsonify({"error": "Вы уже записаны на это мероприятие"}), 400

    registration = Registration(
        user_id=user_id,
        event_id=event_id
    )

    db.session.add(registration)

    event.count += 1

    db.session.commit()

    return jsonify({
        "message": "Вы успешно записались",
        "event_id": event_id
    }), 201


@app.route("/api/events/<int:event_id>/join", methods=["DELETE"])
def leave_event(event_id):
    user_id = session.get("user_id")

    if not user_id:
        return jsonify({"error": "Необходимо войти в аккаунт"}), 401

    registration = Registration.query.filter_by(
        user_id=user_id,
        event_id=event_id
    ).first()

    if not registration:
        return jsonify({"error": "Вы не записаны на это мероприятие"}), 400

    event = Event.query.get(event_id)

    if not event:
        return jsonify({"error": "Мероприятие не найдено"}), 404

    db.session.delete(registration)

    if event.count > 0:
        event.count -= 1

    db.session.commit()

    return jsonify({
        "message": "Запись отменена",
        "event_id": event_id
    })


@app.route("/api/me/registrations", methods=["GET"])
def my_registrations():
    user_id = session.get("user_id")

    if not user_id:
        return jsonify({"error": "Необходимо войти в аккаунт"}), 401

    registrations = Registration.query.filter_by(
        user_id=user_id
    ).all()

    events = []

    for registration in registrations:
        event = Event.query.get(registration.event_id)

        if event:
            events.append(event.to_dict())

    return jsonify({
        "events": events
    })

@app.get("/admin")
def admin_page():
    user = current_user()

    if not user:
        return render_template("index.html")

    if user.role != "admin":
        return render_template("index.html")

    return render_template("admin.html")

@app.post("/api/upload-image")
def api_upload_image():
    if not session.get("user_id"):
        return jsonify({"error": "Необходимо войти в аккаунт"}), 401

    if "image" not in request.files:
        return jsonify({"error": "Изображение не выбрано"}), 400

    image = request.files["image"]

    if not image.filename:
        return jsonify({"error": "Изображение не выбрано"}), 400

    # Only inspect the extension: storage always uses a generated UUID.
    # Sanitizing a Cyrillic-only basename can accidentally remove its dot.
    extension = os.path.splitext(image.filename)[1].lower()

    allowed_extensions = {".jpg", ".jpeg", ".png", ".webp"}

    if extension not in allowed_extensions:
        return jsonify({
            "error": "Поддерживаются только JPG, PNG и WEBP"
        }), 400

    raw = image.read(4 * 1024 * 1024 + 1)
    if len(raw) > 4 * 1024 * 1024:
        return jsonify(error="Фото должно быть не больше 4 МБ."), 413
    try:
        with Image.open(io.BytesIO(raw)) as source:
            if source.format not in {"JPEG", "PNG", "WEBP"}:
                return jsonify(error="Выберите настоящее изображение JPG, PNG или WEBP. HEIC и SVG не поддерживаются."), 400
            if source.width * source.height > 20000000:
                return jsonify(error="Фото слишком большое: максимум 20 мегапикселей. Уменьшите разрешение."), 400
            source.load()
            source = ImageOps.exif_transpose(source)
            source.thumbnail((2400, 2400))
            rgba = source.convert("RGBA")
            clean = Image.new("RGB", rgba.size, "white")
            clean.paste(rgba, mask=rgba.getchannel("A"))
            encoded = io.BytesIO()
            clean.save(encoded, "JPEG", quality=88)
    except (UnidentifiedImageError, ValueError, OSError, Image.DecompressionBombError):
        return jsonify(error="Не удалось прочитать фото. Сохраните его как JPG, PNG или WEBP и выберите снова."), 400
    photo_id = uuid.uuid4().hex
    try:
        db.session.add(EventImage(id=photo_id, user_id=session["user_id"], data=encoded.getvalue()))
        db.session.commit()
    except SQLAlchemyError:
        db.session.rollback()
        app.logger.exception("Could not save event photo")
        return jsonify(error="Не удалось сохранить фото. Попробуйте позже или создайте событие без фото."), 503
    image_url = f"/media/{photo_id}.jpg"

    return jsonify({
        "image_url": image_url
    }), 201

@app.post("/api/events")
def api_create_event():
    data = request.get_json(silent=True) or {}

    required = [
        "title", "summary", "description", "activity", "type",
        "duration", "place", "room", "date", "time", "end", "organizer"
    ]

    missing = [field for field in required if not str(data.get(field, "")).strip()]
    if missing:
        return jsonify({"error": "Не заполнены обязательные поля", "fields": missing}), 400

    try:
        datetime.strptime(str(data["date"]), "%Y-%m-%d")
        datetime.strptime(str(data["time"]), "%H:%M")
        datetime.strptime(str(data["end"]), "%H:%M")
    except ValueError:
        return jsonify(error="Некорректная дата или время"), 400
    if any(len(str(value)) > 10000 for value in data.values()):
        return jsonify(error="Слишком длинное поле"), 400
    if data["end"] <= data["time"]:
        return jsonify({"error": "Окончание должно быть позже начала"}), 400

    user_id = session.get("user_id")

    if not user_id:
        return jsonify({
            "error": "Необходимо войти в аккаунт"
        }), 401

    if data.get("image_url") and not re.fullmatch(r"/media/[a-f0-9]{32}\.jpg", str(data["image_url"])):
        return jsonify({"error": "Сначала загрузите фото"}), 400
    for field in ("chat", "contact"):
        if data.get(field) and not str(data[field]).startswith(("https://", "http://")):
            return jsonify(error="Контакты должны быть HTTP(S) ссылками"), 400
    new_event = Event(
        creator_id=user_id,
        title=str(data["title"]).strip(),
        summary=str(data.get("summary", "")).strip(),
        description=str(data["description"]).strip(),
        activity=str(data["activity"]).strip(),
        type=str(data["type"]).strip(),
        duration=str(data["duration"]).strip(),
        place=str(data["place"]).strip(),
        room=str(data["room"]).strip(),
        date=str(data["date"]).strip(),
        time=str(data["time"]).strip(),
        end=str(data["end"]).strip(),
        regular=bool(data.get("regular", False)),
        organizer=str(data["organizer"]).strip(),
        count=0,
        chat=str(data.get("chat", "")).strip(),
        contact=str(data.get("contact", "")).strip(),
        status="pending",
        image_url=data.get("image_url") or None,
        card_color=data.get("card_color") or "cream",
        card_emoji=data.get("card_emoji") or None,
        tagline=data.get("tagline") or None
    )

    db.session.add(new_event)
    db.session.commit()

    return jsonify(new_event.to_dict()), 201

@app.get("/api/me/events")
def my_events():
    user_id = session.get("user_id")

    if not user_id:
        return jsonify({
            "error": "Необходимо войти в аккаунт"
        }), 401

    events = Event.query.filter_by(
        creator_id=user_id
    ).order_by(
        Event.date,
        Event.time
    ).all()

    return jsonify({
        "events": [event.to_dict() for event in events]
    })

@app.post("/api/auth/register/request")
def register_request():
    data = request.get_json(silent=True) or {}

    username = str(data.get("username", "")).strip()
    email = normalize_email(data.get("email"))

    if not username:
        return jsonify({
            "error": "Введите имя"
        }), 400

    if len(username) > 80:
        return jsonify({
            "error": "Имя слишком длинное"
        }), 400

    if not valid_letovo_email(email):
        return jsonify({
            "error": "Используйте почту @student.letovo.ru или @letovo.ru"
        }), 400

    existing = User.query.filter_by(email=email).first()

    if existing:
        return jsonify({
            "error": "Этот email уже зарегистрирован. Войдите в аккаунт."
        }), 400

    code = create_code()

    auth_code = AuthCode(
        email=email,
        username=username,
        purpose="register",
        code_hash=generate_password_hash(code),
        expires_at=datetime.now(timezone.utc)
        + timedelta(minutes=CODE_LIFETIME_MINUTES)
    )

    db.session.add(auth_code)
    db.session.commit()

    try:
        send_email_code(email, code, "register")
    except Exception:
        db.session.delete(auth_code)
        db.session.commit()

        return jsonify({
            "error": "Не удалось отправить письмо. Попробуйте ещё раз."
        }), 500

    return jsonify({
        "message": "Код отправлен на вашу почту"
    })

@app.post("/api/auth/register/verify")
def register_verify():
    data = request.get_json(silent=True) or {}

    email = normalize_email(data.get("email"))
    code = str(data.get("code", "")).strip()

    if not valid_letovo_email(email):
        return jsonify({
            "error": "Некорректная почта"
        }), 400

    if not code.isdigit() or len(code) != 6:
        return jsonify({
            "error": "Введите 6-значный код"
        }), 400

    auth_code = (
        AuthCode.query
        .filter_by(
            email=email,
            purpose="register"
        )
        .order_by(AuthCode.id.desc())
        .first()
    )

    if not auth_code:
        return jsonify({
            "error": "Код не найден. Запросите новый."
        }), 400

    now = datetime.now(timezone.utc)

    if auth_code.expires_at.replace(tzinfo=timezone.utc) < now:
        return jsonify({
            "error": "Код истёк. Запросите новый."
        }), 400

    if not check_password_hash(
        auth_code.code_hash,
        code
    ):
        return jsonify({
            "error": "Неверный код"
        }), 400

    if User.query.filter_by(email=email).first():
        return jsonify({
            "error": "Этот email уже зарегистрирован."
        }), 400

    user = User(
        username=auth_code.username,
        email=email,
        role="user"
    )

    db.session.add(user)
    db.session.delete(auth_code)
    db.session.commit()

    session.clear()
    session["user_id"] = user.id

    return jsonify({
        "message": "Регистрация завершена",
        "user": user.to_dict()
    })

@app.post("/api/auth/login/request")
def login_request():
    data = request.get_json(silent=True) or {}

    email = normalize_email(data.get("email"))

    if not valid_letovo_email(email):
        return jsonify({
            "error": "Используйте почту @student.letovo.ru или @letovo.ru"
        }), 400

    user = User.query.filter_by(email=email).first()

    if not user:
        return jsonify({
            "error": "Аккаунт не найден. Сначала зарегистрируйтесь."
        }), 404

    code = create_code()

    auth_code = AuthCode(
        email=email,
        username=user.username,
        purpose="login",
        code_hash=generate_password_hash(code),
        expires_at=datetime.now(timezone.utc)
        + timedelta(minutes=CODE_LIFETIME_MINUTES)
    )

    db.session.add(auth_code)
    db.session.commit()

    try:
        send_email_code(email, code, "login")
    except Exception:
        db.session.delete(auth_code)
        db.session.commit()

        return jsonify({
            "error": "Не удалось отправить письмо. Попробуйте ещё раз."
        }), 500

    return jsonify({
        "message": "Код отправлен на вашу почту"
    })

@app.post("/api/auth/login/verify")
def login_verify():
    data = request.get_json(silent=True) or {}

    email = normalize_email(data.get("email"))
    code = str(data.get("code", "")).strip()

    auth_code = (
        AuthCode.query
        .filter_by(
            email=email,
            purpose="login"
        )
        .order_by(AuthCode.id.desc())
        .first()
    )

    if not auth_code:
        return jsonify({
            "error": "Код не найден. Запросите новый."
        }), 400

    now = datetime.now(timezone.utc)

    if auth_code.expires_at.replace(tzinfo=timezone.utc) < now:
        return jsonify({
            "error": "Код истёк. Запросите новый."
        }), 400

    if not check_password_hash(
        auth_code.code_hash,
        code
    ):
        return jsonify({
            "error": "Неверный код"
        }), 400

    user = User.query.filter_by(email=email).first()

    if not user:
        return jsonify({
            "error": "Пользователь не найден"
        }), 404

    db.session.delete(auth_code)
    db.session.commit()

    session.clear()
    session["user_id"] = user.id

    return jsonify({
        "message": "Вход выполнен",
        "user": user.to_dict()
    })

@app.get("/api/auth/me")
def auth_me():
    user_id = session.get("user_id")

    if not user_id:
        return jsonify({
            "user": None
        })

    user = db.session.get(User, user_id)

    if not user:
        session.clear()

        return jsonify({
            "user": None
        })

    return jsonify({
        "user": user.to_dict()
    })

@app.post("/api/auth/logout")
def logout():
    session.clear()

    return jsonify({
        "message": "Вы вышли из аккаунта"
    })

@app.get("/api/admin/users")
def admin_users():
    user, error = admin_required()

    if error:
        return error

    users = User.query.order_by(
        User.created_at.desc()
    ).all()

    return jsonify({
        "users": [
            user.to_dict()
            for user in users
        ]
    })

@app.get("/api/admin/stats")
def admin_stats():
    user, error = admin_required()

    if error:
        return error

    return jsonify({
        "users": User.query.count(),
        "admins": User.query.filter_by(
            role="admin"
        ).count()
    })

@app.get("/api/admin/events")
def admin_events():
    user, error = admin_required()
    if error:
        return error

    events = Event.query.order_by(
        Event.date,
        Event.time,
        Event.id
    ).all()

    return jsonify({
        "events": [event.to_dict() for event in events]
    })

@app.post("/api/admin/events/<int:event_id>/approve")
def approve_event(event_id):
    user, error = admin_required()
    if error:
        return error

    event = Event.query.get_or_404(event_id)

    event.status = "approved"
    event.moderation_comment = None

    db.session.commit()

    return jsonify({
        "success": True,
        "event": event.to_dict()
    })

@app.post("/api/admin/events/<int:event_id>/reject")
def reject_event(event_id):
    user, error = admin_required()
    if error:
        return error

    event = Event.query.get_or_404(event_id)

    data = request.get_json(silent=True) or {}
    comment = data.get("comment", "").strip()

    event.status = "rejected"
    event.moderation_comment = comment or None

    db.session.commit()

    return jsonify({
        "success": True,
        "event": event.to_dict()
    })

@app.post("/api/admin/events/<int:event_id>/unpublish")
def unpublish_event(event_id):
    user, error = admin_required()
    if error:
        return error

    event = Event.query.get_or_404(event_id)

    event.status = "pending"
    event.moderation_comment = "Снято с публикации администратором."

    db.session.commit()

    return jsonify({
        "success": True,
        "event": event.to_dict()
    })

if __name__ == "__main__":
    app.run(debug=os.environ.get("FLASK_DEBUG") == "1")