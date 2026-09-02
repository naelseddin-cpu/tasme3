# tasme3 recognition server — free-and-cheap deployment kit

This folder is a **provider-neutral Docker deployment** for the tasme3
FastAPI recognition + accounts server (`server/`). It builds and runs
unmodified on three different hosts — pick whichever is easiest for you:

| | Cost | Persistence | Setup effort |
|---|---|---|---|
| **A. Oracle Cloud "Always Free" ARM VM** | **$0, permanently** | Yes (Docker volume) | Medium (one VM to set up, once) |
| **B. Small paid VPS** (e.g. Hetzner CX22) | ~€4/month | Yes (Docker volume) | Medium (same steps as A) |
| **C. Google Cloud Run** | Free tier is generous; scale-to-zero | **No** (see caveat below) | Low (one command) |

> Note on Hugging Face Spaces: this deploy kit previously targeted a free
> HF Docker Space, but Hugging Face now requires a paid plan for both
> Docker and Gradio Spaces — only *Static* Spaces (no server code) remain
> free there, which can't run this service. The three options above are
> the current $0-or-near-$0 paths.

Read "Which option should I pick?" below, then jump to that option's
step-by-step guide (English, then the same guide in Arabic).

## Which option should I pick?

- **Want it free forever and don't mind a one-time setup?** → **Option A**
  (Oracle Cloud). This is the recommended default: real persistent
  storage, no sleep/cold-start, and it costs nothing as long as you stay
  within Oracle's "Always Free" limits (which this app easily does).
- **Oracle account signup being difficult, or you'd rather pay a few euros
  a month for a simpler / faster signup?** → **Option B** (any small VPS).
  Identical steps to Option A, just on a paid box.
- **Want the absolute least setup effort, and traffic will be light /
  intermittent?** → **Option C** (Cloud Run). One command, HTTPS for
  free automatically, but read the persistence caveat first — accounts
  and saved progress are not reliably kept.

---

# Option A — Oracle Cloud "Always Free" ARM VM

Oracle's free tier includes a real virtual machine (4 OCPU / 24 GB RAM,
ARM architecture) that is **never charged**, forever, as long as usage
stays inside the free-tier limits — this app is far below them. A card is
required at signup for identity verification only.

### A1. Create the free account

1. Go to **oracle.com/cloud/free** and click **Start for free**.
2. Fill in the signup form (name, email, address, and payment card for
   identity verification — you will not be charged for Always Free
   resources).
3. Verify your email and phone number when asked.

### A2. Create the VM

1. In the Oracle Cloud Console, open the hamburger menu → **Compute** →
   **Instances** → **Create instance**.
2. **Name**: `tasme3-server`.
3. **Image and shape** → **Edit** → Image: **Canonical Ubuntu** (latest
   LTS). Shape: click **Change shape** → **Ampere** → select
   **VM.Standard.A1.Flex** → set **4 OCPUs / 24 GB memory** (this exact
   size is what "Always Free" covers).
4. **Add SSH keys**: let Oracle generate a key pair and **download the
   private key** (you'll need it to log in), or paste your own public key
   if you already have one.
5. Click **Create**. Wait a minute or two for the instance to show
   **Running**, and note its **Public IP address** on the instance's
   detail page.

### A3. Open the firewall for web traffic

1. On the instance's detail page, click the link under **Virtual cloud
   network** → **Security Lists** → the **Default Security List**.
2. **Add Ingress Rules** twice (one rule at a time):
   - Source CIDR `0.0.0.0/0`, IP Protocol TCP, Destination Port `80`
   - Source CIDR `0.0.0.0/0`, IP Protocol TCP, Destination Port `443`
   (Port 22/SSH is already open by default — don't remove that rule.)

### A4. Log in and install Docker

```bash
ssh -i /path/to/your-downloaded-key.key ubuntu@<PUBLIC_IP>

curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
exit          # log out
ssh -i /path/to/your-downloaded-key.key ubuntu@<PUBLIC_IP>   # log back in
docker --version   # confirm it works without sudo now
```

### A5. Get this deploy kit onto the VM

You only need this one folder, not the whole repository checked out
permanently — a shallow clone is enough:

```bash
git clone --depth 1 https://github.com/naelseddin-cpu/tasme3
cd tasme3/deploy/docker
```

### A6. Point a free hostname at your server (needed for HTTPS)

The app is served over HTTPS, and browsers block an HTTPS page from
calling a plain-HTTP server ("mixed content") — so the server needs a real
TLS certificate, which needs a real hostname (not just a bare IP address).

1. Go to **duckdns.org** (free) and sign in with Google or GitHub.
2. Type a subdomain name you like (e.g. `mytasme3`) and click **add
   domain** — you now own `mytasme3.duckdns.org`.
3. Set its **IP** field to your VM's public IP address (from step A2) and
   save.

(`nip.io` is a free zero-signup alternative: a hostname like
`<your-vm-ip>.nip.io` — e.g. `10.20.30.40.nip.io` — always resolves to the
IP embedded in its own name, no account needed. Either works with the
Caddy setup below.)

### A7. Start the server

```bash
echo "TASME3_HOSTNAME=mytasme3.duckdns.org" > .env
docker compose up -d --build
```

The **first** build takes a while (it downloads and converts the
Quran-tuned speech model — a one-time cost, not repeated on restarts).
Watch progress with `docker compose logs -f`.

### A8. Check it's alive

Open `https://mytasme3.duckdns.org/healthz` in a browser. You should see:

```json
{"status": "ok", "model_loaded": true}
```

(Caddy fetches the HTTPS certificate automatically the first time it
starts — give it a minute if this doesn't load instantly.)

### A9. Point the app at your server

Edit `site/config.js` in the tasme3 repo:

```js
window.TASME3_CONFIG = {
  SERVER_URL: 'https://mytasme3.duckdns.org'
};
```

Commit and push. The live app now uses real server-side recognition.

**Persistence**: accounts/progress live in the `tasme3-data` Docker
volume, which survives reboots, `docker compose up --build` rebuilds, and
VM restarts. It is only ever deleted by an explicit
`docker compose down -v`.

---

# Option B — small paid VPS (~€4/month)

Identical steps to Option A — the same `Dockerfile`/`docker-compose.yml`
work unmodified — just skip the Oracle-specific signup and use any
provider's smallest Ubuntu box instead (e.g. **Hetzner Cloud CX22**,
DigitalOcean, Linode, etc., typically €4–6/month):

1. Create an Ubuntu 22.04/24.04 instance with your provider of choice; note
   its public IP.
2. Open ports 80 and 443 in that provider's firewall/security-group
   settings (equivalent of Oracle's Security List, step A3).
3. Follow steps **A4 through A9** above exactly as written — install
   Docker, clone this folder, point a duckdns.org/nip.io hostname at the
   VPS's IP, `docker compose up -d --build`, check `/healthz`, update
   `site/config.js`.

Persistence is identical to Option A (named Docker volume).

---

# Option C — Google Cloud Run

The fastest path to a live HTTPS URL, but read the **persistence caveat**
below before choosing this for anything beyond testing.

### C1. One-time setup

1. Go to **console.cloud.google.com**, create a project (or use an
   existing one), and enable billing (a card is required even to stay
   inside the free tier — Cloud Run's free tier is generous: about 2
   million requests and 360,000 GB-seconds of compute per month before
   anything is charged).
2. Open **Cloud Shell** (the `>_` icon in the top-right of the console) —
   this gives you a terminal with `gcloud` and `docker` already installed,
   no local install needed.

### C2. Deploy

```bash
git clone --depth 1 https://github.com/naelseddin-cpu/tasme3
cd tasme3/deploy/docker

gcloud config set project YOUR_PROJECT_ID

gcloud run deploy tasme3-server \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --memory 2Gi \
  --min-instances 0 \
  --set-env-vars ALLOWED_ORIGINS=https://naelseddin-cpu.github.io
```

This builds the `Dockerfile` (via Cloud Build) and deploys it — no
Caddy/HTTPS setup needed, Cloud Run terminates HTTPS for you
automatically. It prints a URL like
`https://tasme3-server-xxxxxxxxxx-uc.a.run.app` when done.

### C3. Check it's alive

`https://<your-cloud-run-url>/healthz` should show
`{"status": "ok", "model_loaded": true}`.

### C4. Point the app at it

Same as step A9: set `SERVER_URL` in `site/config.js` to the Cloud Run
URL, commit, push.

### Cold starts

With `--min-instances 0` (the default above, keeping cost at $0 when
idle), the **first** request after a quiet period pays a **~10–20 second**
cold start while Cloud Run spins up a container and loads the model. Every
request after that, while the instance stays warm, is fast. Add
`--min-instances 1` to eliminate this entirely (Cloud Run then keeps one
instance always running, which is no longer free — a small ongoing cost).

### ⚠️ Persistence caveat — read before relying on accounts

Cloud Run containers have **no shared, permanent local disk**: the
SQLite file this server writes accounts/progress to
(`server/store.py`) lives inside one container instance's own filesystem,
which Cloud Run can create, reuse for a while, and eventually destroy —
and under real traffic Cloud Run may run **multiple instances at once**,
each with its own separate, unsynced copy of that file. In practice this
means **accounts and saved progress on Cloud Run should be treated as
unreliable, not just temporary** — a user's save-code created against one
instance may simply not exist on the instance that answers their next
request. This is a fundamentally different problem from Option A/B's
"data resets on redeploy" — it can happen on any request, at any time.

Use Cloud Run for a quick demo, a load/latency test, or a low-traffic
setup where the small chance of a mismatched instance is acceptable.
For real users depending on saved accounts and progress, use **Option A or
B**, where the SQLite file lives on a real persistent volume on one
machine.

---

## ARM / aarch64 compatibility (relevant to Option A)

Oracle's free VM is **ARM64**, not the more common x86_64. Every native
(compiled) Python package this image needs — `ctranslate2`,
`faster-whisper`'s own native dependencies (`onnxruntime`, `av`,
`tokenizers`), and `torch` (used only in the build-time model-conversion
stage) — was checked against **PyPI's published wheel listings** and each
one **does publish an aarch64/manylinux wheel for Python 3.11**, matching
this image's `python:3.11-slim` base (Docker automatically pulls the
ARM64 variant of that base image when building on an ARM host). This
means `pip install` needs no special ARM flags or source builds — plain
wheels install directly, same as on x86_64.

This was verified by reading PyPI's package metadata directly (this
repo's build/dev sandbox has no route to actually run `docker build` — no
Docker daemon is available in it — so an end-to-end ARM build could not be
executed here). If a future dependency bump ever drops aarch64 wheel
support, `pip install` on the Oracle VM will fail loudly and immediately
at build time with a "no matching distribution" error, not silently
produce a broken image — so this is safe to trust and easy to catch if it
ever changes.

## Shared notes (all three options)

- **Health check**: `GET /healthz` → `{"status": "ok", "model_loaded":
  true}` once the model has loaded (loads lazily on the first `/evaluate`
  call after each fresh container start — see `server/asr.py`).
- **Privacy**: same guarantee as `server/RUNBOOK.md`'s privacy statement —
  uploaded audio is processed in memory for the duration of one request
  and never written to permanent storage, logged, or retained. By default
  `/evaluate` doesn't even return the transcript text, only which printed
  words were recognized (`?debug=1` opts into the transcript, for local
  debugging only).
- **CORS**: locked to `https://naelseddin-cpu.github.io` via
  `ALLOWED_ORIGINS` (set in the Dockerfile, overridable per-option as
  shown above without rebuilding the image). Add more comma-separated
  origins if the app is ever mirrored elsewhere.
- **Outgrowing any of these**: the app code deployed here is exactly
  `server/` in the main repo, unmodified — moving between these three
  options, or to a bigger VPS later, is a redeploy, never a rewrite.

---

# دليل النشر — نسخة عربية

هذا المجلد يحتوي على **نسخة نشر (Docker) لا ترتبط بمزوّد استضافة معين**
لخادم تسميع (التعرف الصوتي + الحسابات، في `server/`). يعمل دون أي تعديل
على ثلاث بيئات استضافة مختلفة — اختر الأنسب لك:

| | التكلفة | حفظ البيانات | جهد الإعداد |
|---|---|---|---|
| **أ. خادم Oracle Cloud "Always Free" (ARM)** | **مجاني للأبد** | نعم (Docker volume) | متوسط (إعداد خادم مرة واحدة) |
| **ب. خادم VPS صغير مدفوع** (مثل Hetzner CX22) | حوالي 4 يورو/شهريًا | نعم (Docker volume) | متوسط (نفس خطوات أ) |
| **ج. Google Cloud Run** | الفئة المجانية سخية؛ ينام عند عدم الاستخدام | **لا** (انظر التحذير أدناه) | منخفض (أمر واحد) |

> ملاحظة حول Hugging Face Spaces: كان هذا الدليل يستهدف سابقًا خدمة
> Hugging Face المجانية (Docker Space)، لكن Hugging Face أصبحت تتطلب الآن
> اشتراكًا مدفوعًا لكل من Docker وGradio Spaces — فقط الـ Static Spaces
> (بدون كود خادم) بقيت مجانية هناك، ولا يمكنها تشغيل هذه الخدمة. الخيارات
> الثلاثة أعلاه هي الطرق الحالية المجانية أو شبه المجانية.

اقرأ "أي خيار أختار؟" أدناه، ثم انتقل مباشرة إلى دليل الخطوات لذلك الخيار.

## أي خيار أختار؟

- **تريد الحل المجاني للأبد ولا تمانع إعدادًا لمرة واحدة؟** ← **الخيار أ**
  (Oracle Cloud). هذا هو الخيار الافتراضي الموصى به: تخزين دائم حقيقي،
  بدون نوم أو بطء عند البدء، ومجاني تمامًا طالما بقيت ضمن حدود "Always
  Free" من Oracle (وهذا التطبيق بعيد جدًا عن تلك الحدود).
- **واجهت صعوبة في إنشاء حساب Oracle، أو تفضل دفع بضعة يوروهات شهريًا
  مقابل تسجيل أبسط؟** ← **الخيار ب** (أي VPS صغير). نفس خطوات الخيار أ
  تمامًا، على خادم مدفوع فقط.
- **تريد أقل جهد إعداد ممكن، والاستخدام سيكون خفيفًا أو متقطعًا؟** ←
  **الخيار ج** (Cloud Run). أمر واحد فقط، وHTTPS مجاني تلقائيًا، لكن اقرأ
  تحذير حفظ البيانات أولًا — الحسابات والتقدّم المحفوظ لا يُحفظان بشكل
  موثوق فيه.

---

# الخيار أ — خادم Oracle Cloud "Always Free" (ARM)

تتضمن الفئة المجانية من Oracle خادمًا افتراضيًا حقيقيًا (4 أنوية معالج
ARM / 24 جيجابايت ذاكرة) **لا يُفرض عليه رسوم أبدًا**، طالما بقي
الاستخدام ضمن حدود الفئة المجانية — وهذا التطبيق بعيد جدًا عن تلك الحدود.
تحتاج بطاقة دفع عند التسجيل لأغراض التحقق من الهوية فقط.

### أ1. إنشاء الحساب المجاني

1. اذهب إلى **oracle.com/cloud/free** واضغط **Start for free**.
2. املأ نموذج التسجيل (الاسم، البريد الإلكتروني، العنوان، وبطاقة الدفع
   للتحقق من الهوية فقط — لن تُخصم أي رسوم على موارد Always Free).
3. تحقق من بريدك الإلكتروني ورقم هاتفك عند الطلب.

### أ2. إنشاء الخادم الافتراضي (VM)

1. في وحدة تحكم Oracle Cloud، افتح القائمة الجانبية ← **Compute** ←
   **Instances** ← **Create instance**.
2. **الاسم (Name)**: `tasme3-server`.
3. **الصورة والشكل (Image and shape)** ← **Edit** ← الصورة: **Canonical
   Ubuntu** (أحدث إصدار LTS). الشكل: اضغط **Change shape** ← **Ampere** ←
   اختر **VM.Standard.A1.Flex** ← اضبط **4 OCPUs / 24 GB memory** (هذا
   المقاس بالتحديد مغطّى بالكامل ضمن Always Free).
4. **إضافة مفاتيح SSH**: اترك Oracle يُنشئ زوج مفاتيح ثم **نزّل المفتاح
   الخاص**، أو الصق مفتاحك العام الخاص إن كان لديك واحد بالفعل.
5. اضغط **Create**. انتظر دقيقة أو اثنتين حتى تظهر حالة الخادم
   **Running**، ولاحظ **عنوان IP العام** الظاهر في صفحة تفاصيل الخادم.

### أ3. فتح الجدار الناري لحركة الويب

1. من صفحة تفاصيل الخادم، اضغط الرابط تحت **Virtual cloud network** ←
   **Security Lists** ← **Default Security List**.
2. أضف قاعدتين (**Add Ingress Rules**) كل واحدة على حدة:
   - Source CIDR `0.0.0.0/0`، IP Protocol TCP، Destination Port `80`
   - Source CIDR `0.0.0.0/0`، IP Protocol TCP، Destination Port `443`
   (منفذ 22 الخاص بـ SSH مفتوح افتراضيًا — لا تحذف تلك القاعدة.)

### أ4. تسجيل الدخول وتثبيت Docker

```bash
ssh -i /path/to/your-downloaded-key.key ubuntu@<PUBLIC_IP>

curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
exit          # اخرج من الجلسة
ssh -i /path/to/your-downloaded-key.key ubuntu@<PUBLIC_IP>   # أعد الدخول
docker --version   # تأكد أنه يعمل الآن بدون sudo
```

### أ5. جلب حزمة النشر هذه إلى الخادم

تحتاج فقط إلى هذا المجلد، وليس نسخة كاملة دائمة من المستودع — نسخة سطحية
(shallow clone) كافية:

```bash
git clone --depth 1 https://github.com/naelseddin-cpu/tasme3
cd tasme3/deploy/docker
```

### أ6. ربط اسم نطاق مجاني بخادمك (مطلوب لـ HTTPS)

التطبيق يعمل عبر HTTPS، والمتصفحات تمنع صفحة HTTPS من الاتصال بخادم
HTTP عادي ("محتوى مختلط") — لذا يحتاج الخادم شهادة TLS حقيقية، والتي
تحتاج بدورها اسم نطاق حقيقي (وليس مجرد عنوان IP مجرد).

1. اذهب إلى **duckdns.org** (مجاني) وسجّل الدخول عبر Google أو GitHub.
2. اكتب اسم فرعي تختاره (مثل `mytasme3`) واضغط **add domain** — أصبحت
   الآن تمتلك `mytasme3.duckdns.org`.
3. اضبط حقل **IP** الخاص به على عنوان IP العام لخادمك (من الخطوة أ2)
   واحفظ.

(`nip.io` بديل مجاني بدون تسجيل: اسم نطاق مثل
`<عنوان-IP-الخادم>.nip.io` — مثلاً `10.20.30.40.nip.io` — يشير دائمًا
تلقائيًا إلى العنوان المضمّن في اسمه، بدون حاجة لحساب. كلاهما يعمل مع
إعداد Caddy أدناه.)

### أ7. تشغيل الخادم

```bash
echo "TASME3_HOSTNAME=mytasme3.duckdns.org" > .env
docker compose up -d --build
```

عملية البناء **الأولى** تستغرق بعض الوقت (تُنزّل نموذج التعرف الصوتي
وتحوّله — تكلفة تُدفع مرة واحدة فقط، لا تتكرر عند إعادة التشغيل). تابع
التقدّم عبر `docker compose logs -f`.

### أ8. التأكد أن الخدمة تعمل

افتح `https://mytasme3.duckdns.org/healthz` في المتصفح. يجب أن ترى:

```json
{"status": "ok", "model_loaded": true}
```

(يحصل Caddy على شهادة HTTPS تلقائيًا عند أول تشغيل — امنحه دقيقة إن لم
تفتح الصفحة فورًا.)

### أ9. ربط التطبيق بخادمك

عدّل ملف `site/config.js` في مستودع tasme3:

```js
window.TASME3_CONFIG = {
  SERVER_URL: 'https://mytasme3.duckdns.org'
};
```

اعتمد التغيير (commit) وادفعه (push). سيستخدم التطبيق المباشر الآن
التعرف الصوتي الحقيقي من الخادم.

**حفظ البيانات**: الحسابات والتقدّم تُحفظ في وحدة تخزين Docker المسمّاة
`tasme3-data`، والتي تبقى محفوظة عند إعادة التشغيل، وعند إعادة البناء
بأمر `docker compose up --build`، وعند إعادة تشغيل الخادم الافتراضي
نفسه. لا تُحذف إلا بأمر صريح `docker compose down -v`.

---

# الخيار ب — خادم VPS صغير مدفوع (حوالي 4 يورو/شهريًا)

نفس خطوات الخيار أ تمامًا — نفس ملفي `Dockerfile`/`docker-compose.yml`
يعملان دون أي تعديل — فقط تخطَّ تسجيل Oracle واستخدم بدلاً منه أصغر خادم
Ubuntu من أي مزوّد (مثل **Hetzner Cloud CX22**، أو DigitalOcean، أو
Linode، وعادة تكلفتها 4–6 يورو/شهريًا):

1. أنشئ خادم Ubuntu 22.04/24.04 مع المزوّد الذي تختاره، ولاحظ عنوان IP
   العام له.
2. افتح المنفذين 80 و443 في إعدادات الجدار الناري الخاصة بذلك المزوّد
   (مكافئ لـ Security List في Oracle، الخطوة أ3).
3. اتبع الخطوات من **أ4 إلى أ9** أعلاه تمامًا كما هي — تثبيت Docker، جلب
   هذا المجلد، ربط اسم نطاق من duckdns.org أو nip.io بعنوان IP الخاص
   بالـ VPS، تشغيل `docker compose up -d --build`، التحقق من
   `/healthz`، وتحديث `site/config.js`.

حفظ البيانات مطابق تمامًا للخيار أ (وحدة تخزين Docker مسمّاة).

---

# الخيار ج — Google Cloud Run

أسرع طريقة للحصول على رابط HTTPS مباشر، لكن اقرأ **تحذير حفظ البيانات**
أدناه قبل اختيار هذا الخيار لأي شيء أبعد من التجربة.

### ج1. إعداد لمرة واحدة

1. اذهب إلى **console.cloud.google.com**، أنشئ مشروعًا جديدًا (أو استخدم
   مشروعًا موجودًا)، وفعّل الفوترة (بطاقة الدفع مطلوبة حتى للبقاء ضمن
   الفئة المجانية — فئة Cloud Run المجانية سخية: حوالي مليوني طلب و360
   ألف GB-second من المعالجة شهريًا قبل أي رسوم).
2. افتح **Cloud Shell** (أيقونة `>_` أعلى يمين الواجهة) — يمنحك هذا طرفية
   جاهزة مع `gcloud` و`docker` مثبّتين مسبقًا، بدون أي تثبيت محلي.

### ج2. النشر

```bash
git clone --depth 1 https://github.com/naelseddin-cpu/tasme3
cd tasme3/deploy/docker

gcloud config set project YOUR_PROJECT_ID

gcloud run deploy tasme3-server \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --memory 2Gi \
  --min-instances 0 \
  --set-env-vars ALLOWED_ORIGINS=https://naelseddin-cpu.github.io
```

هذا الأمر يبني `Dockerfile` (عبر Cloud Build) وينشره — بدون أي حاجة
لإعداد Caddy أو HTTPS يدويًا، فـ Cloud Run يتولى HTTPS تلقائيًا. سيطبع
رابطًا مثل `https://tasme3-server-xxxxxxxxxx-uc.a.run.app` عند الانتهاء.

### ج3. التأكد أن الخدمة تعمل

`https://<رابط-Cloud-Run>/healthz` يجب أن يُظهر
`{"status": "ok", "model_loaded": true}`.

### ج4. ربط التطبيق به

كما في الخطوة أ9: اضبط `SERVER_URL` في `site/config.js` على رابط Cloud
Run، ثم اعتمد التغيير وادفعه.

### بطء البدء البارد (Cold start)

مع `--min-instances 0` (الافتراضي أعلاه، للإبقاء على التكلفة صفرًا عند
عدم الاستخدام)، أول طلب بعد فترة هدوء يتحمّل بطء بدء بارد لمدة **10–20
ثانية تقريبًا** بينما يُنشئ Cloud Run حاوية جديدة ويحمّل النموذج. كل طلب
بعد ذلك، طالما بقيت الحاوية نشطة، سريع. أضف `--min-instances 1` لإزالة
هذا التأخير تمامًا (سيبقي Cloud Run حينها حاوية واحدة تعمل دائمًا، وهذا
لم يعد مجانيًا — تكلفة صغيرة مستمرة).

### ⚠️ تحذير حفظ البيانات — اقرأ قبل الاعتماد على الحسابات

حاويات Cloud Run **لا تملك قرصًا محليًا دائمًا ومشتركًا**: ملف SQLite
الذي يكتب فيه هذا الخادم الحسابات والتقدّم (`server/store.py`) يعيش داخل
نظام ملفات حاوية واحدة فقط، يمكن لـ Cloud Run إنشاءها، وإعادة استخدامها
لفترة، ثم حذفها — وتحت حركة مرور حقيقية قد يُشغّل Cloud Run **عدة حاويات
في آن واحد**، لكل منها نسخة منفصلة وغير متزامنة من ذلك الملف. عمليًا هذا
يعني أن **الحسابات والتقدّم المحفوظ على Cloud Run يجب اعتبارها غير
موثوقة، لا مؤقتة فقط** — فقد لا يجد رمز الحفظ الذي أنشأه مستخدم على حاوية
معينة أي أثر له عند وصول طلبه التالي إلى حاوية أخرى. هذه مشكلة مختلفة
جوهريًا عن "البيانات تُعاد تصفيرها عند إعادة النشر" في الخيارين أ/ب — فقد
تحدث مع أي طلب، في أي وقت.

استخدم Cloud Run لعرض توضيحي سريع، أو اختبار أداء/استجابة، أو استخدام
خفيف حيث يكون احتمال عدم تطابق الحاوية مقبولًا. أما للمستخدمين الحقيقيين
المعتمدين على حسابات وتقدّم محفوظ، استخدم **الخيار أ أو ب**، حيث يعيش
ملف SQLite على قرص دائم حقيقي على جهاز واحد.

---

## توافق ARM / aarch64 (يخص الخيار أ)

خادم Oracle المجاني هو **ARM64**، وليس x86_64 الأكثر شيوعًا. كل حزمة
بايثون تحتاج ترجمة (compiled) في هذه الصورة — `ctranslate2`، والاعتماديات
الأصلية لـ `faster-whisper` (`onnxruntime`، `av`، `tokenizers`)،
و`torch` (يُستخدم فقط في مرحلة تحويل النموذج وقت البناء) — تم التحقق من
كل واحدة عبر **قوائم الحزم المنشورة على PyPI**، وكل واحدة منها **تنشر
حزمة aarch64/manylinux جاهزة لبايثون 3.11**، وهو ما يطابق صورة القاعدة
`python:3.11-slim` المستخدمة هنا (يسحب Docker تلقائيًا نسخة ARM64 من صورة
القاعدة تلك عند البناء على خادم ARM). هذا يعني أن `pip install` لا يحتاج
أي إعدادات خاصة بـ ARM أو بناء من المصدر — الحزم الجاهزة (wheels) تُثبَّت
مباشرة، تمامًا كما على x86_64.

تم التحقق من هذا عبر قراءة بيانات حزم PyPI مباشرة (بيئة التطوير/البناء
المستخدمة في هذا المستودع لا تملك اتصالاً لتشغيل `docker build` فعليًا —
لا يوجد Docker daemon متاح فيها — لذا لم يكن ممكنًا تنفيذ بناء كامل على
ARM من هنا). إذا أوقفت نسخة مستقبلية من أي اعتمادية دعم aarch64، سيفشل
`pip install` على خادم Oracle بوضوح وفورًا وقت البناء برسالة "no matching
distribution"، وليس بإنتاج صورة معطوبة بصمت — لذا يمكن الوثوق بهذا
التحقق بأمان، وسهل اكتشاف أي تغيير فيه لاحقًا.

## ملاحظات مشتركة (للخيارات الثلاثة)

- **فحص الصحة (Health check)**: `GET /healthz` ← `{"status": "ok",
  "model_loaded": true}` بمجرد تحميل النموذج (يُحمَّل عند أول طلب
  `/evaluate` بعد كل بدء تشغيل جديد للحاوية — انظر `server/asr.py`).
- **الخصوصية**: نفس ضمان `server/RUNBOOK.md` — الصوت المرفوع يُعالج في
  الذاكرة فقط طوال مدة الطلب الواحد ولا يُكتب أبدًا في تخزين دائم، ولا
  يُسجَّل، ولا يُحتفظ به. افتراضيًا لا يُعيد `/evaluate` حتى نص التفريغ،
  فقط الكلمات المطبوعة التي تم التعرف عليها (`?debug=1` فقط للتصحيح
  المحلي).
- **CORS**: مقفل على `https://naelseddin-cpu.github.io` عبر متغيّر البيئة
  `ALLOWED_ORIGINS` (مضبوط في الـ Dockerfile، ويمكن تعديله لكل خيار كما
  هو موضح أعلاه بدون إعادة بناء الصورة). أضف نطاقات أخرى مفصولة بفواصل
  إذا استُضيف التطبيق في مكان آخر مستقبلاً.
- **تجاوز أي من هذه الخيارات لاحقًا**: كود التطبيق المنشور هنا هو بالضبط
  `server/` في المستودع الرئيسي، دون أي تعديل — الانتقال بين هذه
  الخيارات الثلاثة، أو إلى VPS أكبر لاحقًا، هو إعادة نشر فقط، وليس إعادة
  كتابة.
