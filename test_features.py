import os, tempfile, unittest, io
from unittest.mock import patch
from datetime import datetime, timedelta
from PIL import Image
_tmp = tempfile.TemporaryDirectory()
os.environ['DATABASE_URL'] = 'sqlite:///' + os.path.join(_tmp.name, 'test.db').replace('\\', '/')
os.environ['UPLOAD_FOLDER'] = os.path.join(_tmp.name, 'uploads')
os.environ['SECRET_KEY'] = 'test-only-secret'
os.environ['ADMIN_EMAIL'] = ''
import main as m

class Features(unittest.TestCase):
    def setUp(self):
        self.ctx = m.app.app_context(); self.ctx.push()
        m.db.drop_all(); m.db.create_all()
        self.client = m.app.test_client()
    def tearDown(self):
        m.db.session.remove(); self.ctx.pop()
    def login(self, name='A', role='user'):
        u=m.User(username=name,email=name+'@letovo.ru',role=role)
        m.db.session.add(u); m.db.session.commit()
        with self.client.session_transaction() as s: s['user_id']=u.id
        return u.id
    def event(self, status='approved'):
        e=m.Event(title='Test',summary='Summary',description='Description',activity='Sport',type='Club',duration='Hour',place='School',room='AS1',date='2026-11-20',time='17:00',end='18:00',organizer='A',status=status)
        m.db.session.add(e);m.db.session.commit();return e.id
    def test_registration_reuse_and_throttle(self):
        payload=dict(username='Student',email='student@letovo.ru')
        with patch.object(m,'send_email_code') as mail:
            self.assertEqual(self.client.post('/api/auth/register/request',json=payload).status_code,200)
            code=mail.call_args.args[1]
        self.assertEqual(self.client.post('/api/auth/register/request',json=payload).status_code,429)
        verify=dict(email=payload['email'],code=code)
        self.assertEqual(self.client.post('/api/auth/register/verify',json=verify).status_code,200)
        self.assertEqual(self.client.post('/api/auth/register/verify',json=verify).status_code,400)
    def test_expired_code_and_attempt_limit(self):
        m.db.session.add(m.AuthCode(email='a@letovo.ru',username='A',purpose='register',code_hash=m.generate_password_hash('123456'),expires_at=datetime.utcnow()-timedelta(seconds=1)));m.db.session.commit()
        for _ in range(5):
            self.assertEqual(self.client.post('/api/auth/register/verify',json=dict(email='a@letovo.ru',code='123456')).status_code,400)
        self.assertEqual(self.client.post('/api/auth/register/verify',json=dict(email='a@letovo.ru',code='123456')).status_code,429)
    def test_login_code(self):
        self.login()
        with self.client.session_transaction() as s:s.clear()
        with patch.object(m,'send_email_code') as mail:
            u=m.User.query.first();u.email='a@letovo.ru';m.db.session.commit()
            self.assertEqual(self.client.post('/api/auth/login/request',json=dict(email='a@letovo.ru')).status_code,200)
            code=mail.call_args.args[1]
        self.assertEqual(self.client.post('/api/auth/login/verify',json=dict(email='a@letovo.ru',code=code)).status_code,200)
    def test_upload_decodes_and_serves(self):
        self.login()
        self.assertEqual(self.client.post('/api/upload-image',data={'image':(io.BytesIO(b'fake'),'fake.jpg')}).status_code,400)
        stream=io.BytesIO();Image.new('RGB',(20,20)).save(stream,'PNG');stream.seek(0)
        r=self.client.post('/api/upload-image',data={'image':(stream,'photo.png')});self.assertEqual(r.status_code,201)
        response=self.client.get(r.json['image_url']); self.assertEqual(response.status_code,200); response.close()
    def test_photo_persists_without_local_writes(self):
        uid=self.login()
        stream=io.BytesIO();Image.new('RGBA',(2500,20),(255,0,0,0)).save(stream,'PNG');stream.seek(0)
        with patch.object(m.os, 'makedirs', side_effect=OSError('Read-only filesystem')) as mkdir:
            r=self.client.post('/api/upload-image',data={'image':(stream,'фото.png')})
            self.assertEqual(r.status_code,201);mkdir.assert_not_called()
        photo=m.EventImage.query.one();self.assertEqual(photo.user_id,uid)
        m.db.session.remove()
        response=m.app.test_client().get(r.json['image_url'])
        self.assertEqual(response.status_code,200)
        with Image.open(io.BytesIO(response.data)) as result:
            self.assertEqual(result.format,'JPEG');self.assertEqual(result.width,2400)
            self.assertEqual(result.getpixel((0,0)),(255,255,255))
        response.close()
    def test_photo_file_and_pixel_limits(self):
        self.login()
        r=self.client.post('/api/upload-image',data={'image':(io.BytesIO(b'x'*(4*1024*1024+1)),'large.jpg')})
        self.assertEqual(r.status_code,413)
        with patch.object(m.Image, 'open') as opened:
            source=opened.return_value.__enter__.return_value
            source.format='JPEG';source.width=5001;source.height=4000
            r=self.client.post('/api/upload-image',data={'image':(io.BytesIO(b'fake'),'large.jpg')})
            self.assertEqual(r.status_code,400);source.load.assert_not_called()
        self.assertEqual(m.EventImage.query.count(),0)
    def test_photo_database_failure_is_not_invalid_image(self):
        self.login()
        stream=io.BytesIO();Image.new('RGB',(20,20)).save(stream,'JPEG');stream.seek(0)
        with patch.object(m.db.session, 'commit', side_effect=m.SQLAlchemyError('storage unavailable')):
            with self.assertLogs(m.app.logger,level='ERROR'):
                r=self.client.post('/api/upload-image',data={'image':(stream,'photo.jpg')})
        self.assertEqual(r.status_code,503)
        self.assertEqual(m.EventImage.query.count(),0)

    def test_comments_permissions_and_visibility(self):
        eid=self.event(); hidden=self.event('pending')
        self.assertEqual(self.client.post(f'/api/events/{eid}/comments',json={'body':'hello'}).status_code,401)
        self.login();r=self.client.post(f'/api/events/{eid}/comments',json={'body':'<b>hello</b>'});self.assertEqual(r.status_code,200);cid=r.json[0]['id']
        self.assertEqual(self.client.get(f'/api/events/{hidden}/comments').status_code,404)
        self.login('B');self.assertEqual(self.client.delete(f'/api/comments/{cid}').status_code,403)
        self.login('Admin','admin');self.assertEqual(self.client.delete(f'/api/comments/{cid}').status_code,200)
    def test_event_creation_customization_and_moderation(self):
        payload=dict(title='Photo event',summary='Summary',description='Details',activity='Sport',type='Club',duration='Hour',place='School',room='AS1',date='2026-11-20',time='17:00',end='18:00',organizer='Student',card_color='cream',card_emoji='*',tagline='Welcome')
        self.assertEqual(self.client.post('/api/events',json=payload).status_code,401)
        self.login()
        r=self.client.post('/api/events',json=payload);self.assertEqual(r.status_code,201)
        self.assertEqual(r.json['card_emoji'],'*');self.assertEqual(r.json['status'],'pending')
        self.assertEqual(self.client.get('/api/events').json,[])
        payload['image_url']='https://example.com/photo.jpg'
        self.assertEqual(self.client.post('/api/events',json=payload).status_code,400)

    def test_map_and_origin(self):
        import json
        from pathlib import Path
        rooms=json.loads(Path('static/maps/rooms.json').read_text(encoding='utf-8'))
        self.assertEqual(len(rooms),149)
        for r in rooms:
            with Image.open(f'static/maps/floor_{r["floor"]}.png') as im:
                self.assertTrue(0 <= r['x'] <= r['reference_width'] and 0 <= r['y'] <= r['reference_height'])
        self.assertEqual(self.client.get('/map').status_code,200)
        self.assertEqual(self.client.post('/api/auth/logout',headers={'Origin':'https://evil.example'}).status_code,403)
    def test_email_fails_closed(self):
        with patch.dict(os.environ, {'SMTP_HOST':'','MAIL_MODE':''}):
            with self.assertRaises(RuntimeError):m.send_email_code('a@letovo.ru','123456','login')
def tearDownModule():
    with m.app.app_context():
        m.db.session.remove(); m.db.engine.dispose()
    _tmp.cleanup()

if __name__ == '__main__': unittest.main()
