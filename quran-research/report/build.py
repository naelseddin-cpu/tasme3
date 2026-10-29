"""Build the Arabic رزق report. Every ayah is pulled verbatim from quran.json;
highlights are located by matching normalized words, and the script fails if a
phrase is not found, so no Quranic text is ever typed by hand."""
import json, re, sys, html

Q = json.load(open(sys.argv[1]))
OUT = sys.argv[2]
NAME = {s['id']: s['name'] for s in Q}
NAME[14] = 'إبراهيم'
TEXT = {(s['id'], v['id']): v['text'] for s in Q for v in s['verses']}

DIAC = re.compile(r'[ً-ٰٟۖ-ۭـ۞]')
def norm(w):
    w = DIAC.sub('', w)
    w = re.sub('[ٱأإآ]', 'ا', w).replace('ى', 'ي').replace('ة', 'ه')
    return re.sub('[اءؤئ]', '', w.replace('ؤ', 'ء').replace('ئ', 'ء'))
def strip(w):
    return DIAC.sub('', w).replace('ٱ', 'ا')
ROOT = re.compile(r'ر[اى]?ز[او]?ق')
def is_root(w): return bool(ROOT.search(strip(w)))

# sanity: the root count must match the morphology corpus (123 / 109 verses)
occ = [(k, w) for k, t in TEXT.items() for w in t.split() if is_root(w)]
assert len(occ) == 123 and len({k for k, _ in occ}) == 109, len(occ)
RZQ_VERSES = sorted({k for k, _ in occ})

def find_span(words, phrase):
    p = [norm(x) for x in phrase.split()]
    n = [norm(x) for x in words]
    for i in range(len(n) - len(p) + 1):
        if n[i:i + len(p)] == p:
            return i, i + len(p)
    return None

def ref(s, a): return f'{NAME[s]}: {a}'
def parse(r):
    s, a = r.split(':'); return int(s), int(a)

def ayah(r, phrase=None, small=False):
    s, a = parse(r)
    words = TEXT[(s, a)].split()
    span = None
    if phrase:
        span = find_span(words, phrase)
        if not span:
            sys.exit(f'PHRASE NOT FOUND {r}: {phrase}')
    out = []
    for i, w in enumerate(words):
        h = html.escape(w)
        if is_root(w): h = f'<span class="rt">{h}</span>'
        out.append(h)
    if span:
        i, j = span
        out[i] = '<mark>' + out[i]; out[j - 1] += '</mark>'
    cls = 'ayah small' if small else 'ayah'
    return (f'<figure class="{cls}"><blockquote>﴿{" ".join(out)}﴾</blockquote>'
            f'<figcaption>[{ref(s, a)}]</figcaption></figure>')

def search(phrase):
    p = [norm(x) for x in phrase.split()]
    hits = []
    for k in sorted(TEXT):
        n = [norm(x) for x in TEXT[k].split()]
        if any(n[i:i + len(p)] == p for i in range(len(n) - len(p) + 1)):
            hits.append(f'{k[0]}:{k[1]}')
    return hits

def proof(phrase, label, expect=None, extra=()):
    hits = search(phrase)
    if expect is not None:
        assert len(hits) == expect, (phrase, hits)
    refs = hits + [r for r in extra if r not in hits]
    body = ''.join(ayah(r, phrase if r in hits else None, small=True) for r in refs)
    return (f'<details class="proof"><summary>{label} — <b>{len(hits)}</b> مواضع'
            f'{" + " + str(len(extra)) + " قريب منها" if extra else ""} (عرض الآيات كاملة)</summary>{body}</details>')

def point(title, text, *items):
    return (f'<div class="point"><h3>{title}</h3>'
            + (f'<p>{text}</p>' if text else '') + ''.join(items) + '</div>')

def note(text): return f'<p class="note"><b>تأمّل:</b> {text}</p>'

S = []  # (id, number, title, lead, html)

S.append(('who', '١', 'من الرازق؟ الله وحده',
 'أول ما يقرره القرآن أن الرزق له مصدر واحد، ويقيم على ذلك الدليل ثم يتحدى به.',
 point('الدعوى: الرزّاق اسم لله', 'صيغة «الرزّاق» لم ترد في القرآن إلا مرة واحدة، وجاءت بعد نفي حاجة الله إلى رزق من خلقه.',
       ayah('51:57', 'ما أريد منهم من رزق'), ayah('51:58', 'إن الله هو الرزاق ذو القوة المتين'))
 + point('الدليل: الماء من السماء يخرج الرزق من الأرض', None,
       ayah('2:22', 'وأنزل من السماء ماء فأخرج به من الثمرات رزقا لكم'),
       ayah('51:22', 'وفي السماء رزقكم'),
       '<details class="proof"><summary>آيات أخرى تربط الرزق بالماء النازل من السماء (عرض الآيات كاملة)</summary>'
       + ''.join(ayah(r, p, True) for r, p in [('14:32', 'فأخرج به من الثمرات رزقا لكم'), ('40:13', 'وينزل لكم من السماء رزقا'),
                                               ('45:5', 'وما أنزل الله من السماء من رزق'), ('50:9', 'ونزلنا من السماء ماء مباركا'),
                                               ('50:11', 'رزقا للعباد')]) + '</details>')
 + point('الضمان: لكل دابة رزقها', None,
       ayah('11:6', 'إلا على الله رزقها'), ayah('29:60', 'الله يرزقها وإياكم'))
 + point('التحدي: من يرزقكم؟', 'سؤال يتكرر في القرآن بنفس اللفظ تقريبًا، وجوابه واحد.',
       ayah('10:31', 'قل من يرزقكم من السماء والأرض'),
       '<details class="proof"><summary>مواضع السؤال الأخرى (عرض الآيات كاملة)</summary>'
       + ''.join(ayah(r, p, True) for r, p in [('27:64', 'ومن يرزقكم من السماء والأرض'), ('34:24', 'قل من يرزقكم من السماوات والأرض'),
                                               ('35:3', 'هل من خالق غير الله يرزقكم من السماء والأرض'), ('67:21', 'أمن هذا الذي يرزقكم إن أمسك رزقه')]) + '</details>')
 + point('النتيجة: غير الله لا يملك رزقًا', None,
       ayah('29:17', 'لا يملكون لكم رزقا فابتغوا عند الله الرزق'), ayah('16:73', 'ما لا يملك لهم رزقا من السماوات والأرض شيئا'),
       ayah('30:40', 'الله الذي خلقكم ثم رزقكم ثم يميتكم ثم يحييكم'),
       note('في آية الروم جاء الرزق ثانيًا بعد الخلق مباشرة، ثم الموت ثم الحياة، وكلها حجة على أن الشركاء لا يفعلون شيئًا منها.'))))

S.append(('how', '٢', 'كيف يُقسَم؟ بسطًا وقدرًا',
 'الرزق لا يُقسَم بالتساوي. يوسّعه الله على قوم ويضيّقه على آخرين، وقد يعطي بلا حساب.',
 point('القاعدة المتكررة: يبسط ويقدر', '«يقدر» هنا بمعنى يضيّق.',
       ayah('13:26', 'الله يبسط الرزق لمن يشاء ويقدر'), ayah('17:30', 'إن ربك يبسط الرزق لمن يشاء ويقدر'),
       proof('يبسط الرزق لمن يشاء', 'عبارة «يبسط الرزق لمن يشاء»', expect=9))
 + point('وقد يعطي بغير حساب', None,
       ayah('3:37', 'إن الله يرزق من يشاء بغير حساب'),
       proof('يرزق من يشاء بغير حساب', 'عبارة «يرزق من يشاء بغير حساب»', expect=3, extra=['3:27']))
 + point('والتفاوت مقصود', None, ayah('16:71', 'والله فضل بعضكم على بعض في الرزق'))))

S.append(('why', '٣', 'لماذا التفاوت؟ ابتلاء',
 'السعة ليست دليل كرامة، والضيق ليس دليل إهانة. كلاهما اختبار.',
 point('لو بسطه للجميع لطغوا', None, ayah('42:27', 'ولو بسط الله الرزق لعباده لبغوا في الأرض'))
 + point('الضيق ليس إهانة، والسعة ليست كرامة', 'الآيات الثلاث متتالية في سورة الفجر، والرد عليهما معًا بـ«كلا».',
       ayah('89:15', 'فيقول ربي أكرمن'), ayah('89:16', 'فقدر عليه رزقه فيقول ربي أهانن'), ayah('89:17', 'كلا'))
 + point('قارون: سعة انتهت بخسف', 'قالها الذين تمنّوا مكانه بالأمس، بعد أن رأوا الخسف.',
       ayah('28:82', 'ويكأن الله يبسط الرزق لمن يشاء من عباده ويقدر'))
 + point('فلا تمدّ عينك إلى ما عند غيرك', None, ayah('20:131', 'ورزق ربك خير وأبقى'))))

S.append(('do', '٤', 'ماذا تفعل بالرزق؟ أربعة واجبات',
 'بعد أن عرفت مصدره وحكمة تقسيمه، يأتي ما يُطلب منك فيه.',
 point('١. كُل من الطيّب الحلال', None,
       ayah('2:172', 'كلوا من طيبات ما رزقناكم'), ayah('5:88', 'وكلوا مما رزقكم الله حلالا طيبا'),
       proof('كلوا من طيبات ما رزقناكم', 'عبارة «كلوا من طيبات ما رزقناكم»', expect=4))
 + point('٢. اشكر', 'يأتي الأمر بالشكر ملاصقًا للأمر بالأكل.',
       ayah('16:114', 'واشكروا نعمت الله إن كنتم إياه تعبدون'), ayah('34:15', 'كلوا من رزق ربكم واشكروا له'))
 + point('٣. أنفق منه', 'الإنفاق دائمًا «مِمّا» رزقهم، أي من بعضه لا من كله.',
       ayah('2:3', 'ومما رزقناهم ينفقون'),
       proof('ومما رزقناهم ينفقون', 'عبارة «ومما رزقناهم ينفقون»', expect=6),
       proof('مما رزقناهم سرا وعلانية', 'عبارة «مما رزقناهم سرا وعلانية»', expect=3),
       '<h4>قبل فوات الأوان</h4>',
       ayah('63:10', 'وأنفقوا من ما رزقناكم من قبل أن يأتي أحدكم الموت'),
       ayah('2:254', 'أنفقوا مما رزقناكم من قبل أن يأتي يوم لا بيع فيه'),
       '<h4>وما تنفقه لا يضيع</h4>',
       ayah('34:39', 'وما أنفقتم من شيء فهو يخلفه وهو خير الرازقين'))
 + point('٤. ارزق من تعول', 'هنا يصير الإنسان نفسه مأمورًا بأن يرزق غيره.',
       ayah('2:233', 'وعلى المولود له رزقهن وكسوتهن بالمعروف'),
       ayah('4:8', 'فارزقوهم منه وقولوا لهم قولا معروفا'), ayah('4:5', 'وارزقوهم فيها واكسوهم'))))

S.append(('wrong', '٥', 'ما الذي يُفسد الرزق؟',
 'خمسة أخطاء يذكرها القرآن في التعامل مع الرزق.',
 point('١. تحريم ما أحلّ الله', None,
       ayah('10:59', 'فجعلتم منه حراما وحلالا'), ayah('6:140', 'وحرموا ما رزقهم الله افتراء على الله'))
 + point('٢. قتل الأولاد خوف الفقر', None,
       ayah('6:151', 'ولا تقتلوا أولادكم من إملاق نحن نرزقكم وإياهم'),
       ayah('17:31', 'ولا تقتلوا أولادكم خشية إملاق نحن نرزقهم وإياكم'),
       note('في الأنعام: «مِنْ إملاق»، أي الفقر واقع فعلًا، فقدّم الآباء: «نرزقكم وإياهم». وفي الإسراء: «خشيةَ إملاق»، أي الفقر متوقَّع، فقدّم الأبناء: «نرزقهم وإياكم». اختلاف الترتيب ثابت في النص، أما تعليله فهو من كلام المفسرين.'))
 + point('٣. جعل نصيب منه لغير الله', None, ayah('16:56', 'ويجعلون لما لا يعلمون نصيبا مما رزقناهم'))
 + point('٤. كفر النعمة', 'قصتان بنفس الدورة: رزق واسع، ثم جحود، ثم زوال.',
       ayah('16:112', 'يأتيها رزقها رغدا من كل مكان فكفرت بأنعم الله'),
       ayah('34:15', 'كلوا من رزق ربكم واشكروا له'), ayah('34:16', 'فأعرضوا'))
 + point('٥. البخل والتكذيب', None,
       ayah('36:47', 'أنطعم من لو يشاء الله أطعمه'), ayah('56:82', 'وتجعلون رزقكم أنكم تكذبون'))))

S.append(('end', '٦', 'إلى أين ينتهي؟ رزق الجنة',
 'رزق الدنيا مقدَّر يُبسط ويُقدَر، ورزق الآخرة بغير حساب ولا ينفد.',
 point('بغير حساب، ولا ينفد', None,
       ayah('40:40', 'يرزقون فيها بغير حساب'), ayah('38:54', 'إن هذا لرزقنا ما له من نفاد'),
       ayah('19:62', 'ولهم رزقهم فيها بكرة وعشيا'))
 + point('الوعد المتكرر: مغفرة ورزق كريم', None,
       ayah('8:4', 'لهم درجات عند ربهم ومغفرة ورزق كريم'),
       proof('ورزق كريم', 'عبارة «مغفرة ورزق كريم»', expect=5))
 + point('الشهداء والمهاجرون', None,
       ayah('3:169', 'بل أحياء عند ربهم يرزقون'), ayah('22:58', 'ليرزقنهم الله رزقا حسنا'))
 + point('وأهل النار يُحرَمونه', None, ayah('7:50', 'أفيضوا علينا من الماء أو مما رزقكم الله'))))

S.append(('stories', '٧', 'شواهد من قصص الأنبياء',
 'الرزق حاضر في قصص كثيرة، وأوضحها دعاء إبراهيم واستجابته.',
 point('إبراهيم يدعو لمكة، والإجابة في سورة أخرى', 'دعا بالأمن والرزق معًا، فجاء في القصص: «حرمًا آمنًا… رزقًا من لدنّا».',
       ayah('2:126', 'رب اجعل هذا بلدا آمنا وارزق أهله من الثمرات'),
       ayah('14:37', 'وارزقهم من الثمرات لعلهم يشكرون'),
       ayah('28:57', 'أولم نمكن لهم حرما آمنا يجبى إليه ثمرات كل شيء رزقا من لدنا'))
 + point('مريم في المحراب', None, ayah('3:37', 'وجد عندها رزقا'))
 + point('موسى وقومه', None, ayah('2:60', 'كلوا واشربوا من رزق الله'))
 + point('عيسى والمائدة', None, ayah('5:114', 'وارزقنا وأنت خير الرازقين'))
 + point('شعيب', None, ayah('11:88', 'ورزقني منه رزقا حسنا'))
 + point('يوسف في السجن', None, ayah('12:37', 'لا يأتيكما طعام ترزقانه'))
 + point('أصحاب الكهف', None, ayah('18:19', 'فليأتكم برزق منه'))))

appendix = ''.join(ayah(r, None, True) for r in [f'{s}:{a}' for s, a in RZQ_VERSES])

nav = ''.join(f'<li><a href="#{i}"><span>{n}</span>{t}</a></li>' for i, n, t, _, _ in S)
secs = ''.join(f'<section id="{i}"><header><span class="num">{n}</span><h2>{t}</h2></header><p class="lead">{l}</p>{h}</section>'
               for i, n, t, l, h in S)

page = open(sys.argv[3]).read().replace('{{NAV}}', nav).replace('{{SECTIONS}}', secs).replace('{{APPENDIX}}', appendix)
open(OUT, 'w').write(page)
print('ok', len(page))
