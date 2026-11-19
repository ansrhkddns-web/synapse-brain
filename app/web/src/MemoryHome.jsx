// 기억 탭 "한눈에" = 기억 정리.
//   보관함의 모든 기억을 세 가지로 나눠 보여 준다 (서버 lib/memrank.mjs가 매김, GET /api/memory/rank)
//     층   지금(손이 가는 일) · 기준(늘 지키는 것) · 결과(다시 찾아볼 것) · 흔적(그냥 남은 기록)
//     출처 어떻게 쌓였나 — 내 손(말함·결정·승인·시킴) · 세션(씀·따라 적음·예약) · 자동(자동 기록·규칙)
//     무게 0~100, 막대 셋 — 줄을 펼치면 매긴 까닭(+/-)이 보인다. 핵심으로 고정 / 흔적으로 내리기는 기억/분류.json에 남는다
//   흔적 층을 고르면 날짜별 원문 시간줄(주인 말·검수 판정·세션 지시)도 함께. 서버가 한꺼번에 쌓은 줄은 한 줄로 묶는다.
import { useEffect, useMemo, useState } from 'react';
import { api } from './api.js';
import { Icon } from './icons.jsx';
import { Markdown } from './Markdown.jsx';
import { STATUS, shortTime } from './util.js';

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const WEEK = '일월화수목금토';
function dayLabel(date) {
  const now = new Date();
  const y = new Date(now); y.setDate(now.getDate() - 1);
  const [yy, m, d] = date.split('-').map(Number);
  const w = WEEK[new Date(yy, m - 1, d).getDay()];
  if (date === ymd(now)) return `오늘 · ${m}월 ${d}일 (${w})`;
  if (date === ymd(y)) return `어제 · ${m}월 ${d}일 (${w})`;
  return `${m}월 ${d}일 (${w})`;
}

const SOURCE_LABEL = { 주인말: '주인 말', 검수판정: '검수 판정', 세션지시: '세션 지시' };
// 종류 → 색(먹지 상태색): 시킨 말 주홍 · 결정 노랑 · 완료 초록 · 다시 열기 빨강 · 질문/세션 청록 · 나머지 회색
const TONE = { 지시: 'acc', 이어서: 'acc', '지금 실행': 'acc', 결정: 'wait', 권한: 'wait', 완료: 'done', '다시 열기': 'err', 취소: 'off', 질문: 'work', '세션 지시': 'work', '기억 분류': 'mute' };
const toneOf = (kind) => TONE[kind] ?? (String(kind ?? '').startsWith('일정') ? 'mute' : '');
const mins = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };

// 항목 목록: 시각 | 종류 | 이어진 문서 카드 + 말.
//   세션 지시는 같은 작업끼리 한 줄로, 검수 판정처럼 서버가 몇 분 안에 같은 종류를 3개 넘게 쌓은 것은 "한꺼번에" 한 줄로 묶어 펼쳐 본다
export function MemoryLog({ entries, refs, ctx, dense = false }) {
  const rows = useMemo(() => {
    const out = [];
    const groups = new Map();
    for (const e of entries) {
      if (e.source === '세션지시') {
        const k = `${e.date}:${e.task ?? e.group}`;
        if (groups.has(k)) { groups.get(k).more.push(e); continue; }
        const row = { ...e, key: k, more: [e] };
        groups.set(k, row);
        out.push(row);
        continue;
      }
      const last = out[out.length - 1];
      if (last && e.source === '검수판정' && last.source === e.source && last.kind === e.kind && last.date === e.date && Math.abs(mins(last.lastTime ?? last.time) - mins(e.time)) <= 10) {
        (last.batch ??= [{ ...last }]).push(e);
        last.lastTime = e.time;
        continue;
      }
      out.push({ ...e, key: `${e.name}:${e.time}:${out.length}` });
    }
    // 둘뿐인 묶음은 도로 푼다
    return out.flatMap((r) => (r.batch && r.batch.length < 3 ? r.batch.map((e, i) => ({ ...e, key: `${r.key}:${i}` })) : [r]));
  }, [entries]);
  return (
    <div className={`mlog ${dense ? 'dense' : ''}`}>
      {rows.map((r) => (r.batch ? <BatchRow key={r.key} r={r} refs={refs} ctx={ctx} /> : <MemRow key={r.key} r={r} refs={refs} ctx={ctx} />))}
    </div>
  );
}

function BatchRow({ r, refs, ctx }) {
  const [open, setOpen] = useState(false);
  const list = [...r.batch].sort((a, b) => a.time.localeCompare(b.time));
  return (
    <div className="mrow batch">
      <time className="mrow-t">{list[0].time}</time>
      <span className={`mkind ${toneOf(r.kind)}`}>{r.kind ?? SOURCE_LABEL[r.source]}</span>
      <div className="mrow-b">
        <button className="mbatch" onClick={() => setOpen((v) => !v)} title="서버가 몇 분 안에 한꺼번에 쌓은 기록">
          <Icon name="chev" size={11} className={`chev ${open ? 'open' : ''}`} />
          <b>{list.length}건 한꺼번에</b>
          <span>{list[0].time}–{list.at(-1).time} · 자동 기록</span>
        </button>
        {open && <div className="mbatch-list">{list.map((e, i) => (e.task ? <DocChip key={i} id={e.task} info={refs?.[e.task]} fallback={e.text} ctx={ctx} /> : <span key={i}>{e.text}</span>))}</div>}
      </div>
    </div>
  );
}

function MemRow({ r, refs, ctx }) {
  const [open, setOpen] = useState(false);
  const ref = r.task ? refs?.[r.task] : null;
  // 검수·결정 줄은 말 앞에 문서 이름이 한 번 더 적혀 있다 — 카드가 보여 주니 뺀다
  let text = r.text;
  if (ref?.title && text.startsWith(ref.title)) text = text.slice(ref.title.length).trim();
  const many = r.more?.length > 1;
  const items = many ? [...r.more].sort((a, b) => a.time.localeCompare(b.time)) : null;
  return (
    <div className="mrow">
      <time className="mrow-t">{r.time}</time>
      <span className={`mkind ${toneOf(r.kind)}`}>{r.kind ?? SOURCE_LABEL[r.source]}</span>
      <div className="mrow-b">
        {r.task && <DocChip id={r.task} info={ref} fallback={r.group} ctx={ctx} />}
        {text && <Markdown className="mrow-text" text={text} onOpen={(id, o) => (o?.newTab ? ctx.open(id, o) : ctx.inspect(id))} onPreview={ctx.preview} />}
        {many && (
          <>
            <button className="linkbtn" onClick={() => setOpen((v) => !v)}>{open ? '접기' : `이 작업에 한 말 ${r.more.length}개 모두 보기`}</button>
            {open && (
              <ul className="mrow-more">
                {items.map((e, i) => <li key={i}><time>{e.time}</time><span>{e.text}</span></li>)}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// 이어진 문서 한 칸: 부서 색 점 · 이름 · ID · 지금 상태
function DocChip({ id, info, fallback, ctx }) {
  const status = ctx.state.tasks.find((t) => t.id === id)?.status ?? info?.status;
  const label = STATUS[status]?.label ?? status;
  return (
    <button className="dchip" onClick={(e) => ctx.pick(id, e)} title={`${id} — 누르면 오른쪽에, Ctrl+클릭은 새 탭`}>
      <i style={{ '--c': ctx.deptColor[info?.dept] ?? 'var(--faint)' }} />
      <span className="dchip-t">{info?.title ?? fallback ?? id}</span>
      <span className="dchip-id mono">{id}</span>
      {label && <span className={`tag ${STATUS[status]?.tone ?? ''}`}>{label}</span>}
    </button>
  );
}

// ── 기억 정리 ──
const LAYERS = [
  { key: '지금', hint: '손이 가는 일', desc: '진행 · 검수 · 결정 대기' },
  { key: '기준', hint: '늘 지키는 것', desc: '기억 카드 · 규칙 · 예약' },
  { key: '결과', hint: '다시 찾아볼 것', desc: '결정 · 보고서 · 끝난 작업' },
  { key: '흔적', hint: '그냥 남은 기록', desc: '말·판정 원문 · 빈 작업' },
];
const NEEDED = ['지금', '기준', '결과'];
// 출처는 셋으로 묶는다: 내 손이 닿은 것 · 세션이 만든 것 · 자동으로 쌓인 것
const FAMILY = [
  { key: 'me', label: '내 손', desc: '내가 말하고, 고르고, 승인하고, 시킨 것', origins: ['내가 말함', '내가 결정', '내가 승인', '내가 시킴'] },
  { key: 'ses', label: '세션', desc: 'Claude 세션이 만들었거나 다른 곳 대화를 두뇌가 따라 적은 것', origins: ['세션이 씀', '따라 적음', '예약 실행'] },
  { key: 'auto', label: '자동·규칙', desc: '서버가 저절로 쌓은 기록과 정해 둔 규칙 문서', origins: ['자동 기록', '규칙'] },
];
const famOf = (o) => FAMILY.find((f) => f.origins.includes(o))?.key ?? 'auto';
const ORIGIN_HINT = {
  '내가 말함': '그날 내가 한 말을 모은 원문',
  '내가 결정': '결정 요청에 내가 고른 답',
  '내가 승인': '내가 승인한 기억 카드',
  '내가 시킴': '두뇌에서 내가 직접 맡긴 작업',
  '세션이 씀': '세션이 정리해 남긴 문서',
  '따라 적음': '다른 곳(Claude 앱·코드)에서 한 대화를 두뇌가 작업으로 따라 적은 것',
  '예약 실행': '예약이 때가 되어 돌면서 생긴 것',
  '자동 기록': '서버가 저절로 쌓은 기록 (검수 판정·세션 지시)',
  규칙: '일하는 방식을 정해 둔 문서',
};
const TYPE_LABEL = { 기억카드: '기억 카드', 주인말: '주인 말', 검수판정: '검수 판정', 세션지시: '세션 지시', 배움: '배움', 노트: '공통 규칙', 부서: '부서 규칙', 하위: '하위 안내' };
const bars = (score) => (score >= 60 ? 3 : score >= 35 ? 2 : 1);
const WEIGHT = ['', '가벼움', '참고', '중요'];
const LS = 'brain.memory.sort';

export function MemoryHome({ ctx, setTab }) {
  const [rank, setRank] = useState(null);
  const [layer, setLayer] = useState('필요');      // '필요' = 지금+기준+결과
  const [family, setFamily] = useState(null);      // 출처 묶음 거르기
  const [origin, setOrigin] = useState(null);      // 출처 하나 거르기
  const [dept, setDept] = useState('');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState(() => { try { return localStorage.getItem(LS) || 'score'; } catch { return 'score'; } });
  useEffect(() => { try { localStorage.setItem(LS, sort); } catch { /* 없어도 됨 */ } }, [sort]);
  const [err, setErr] = useState(null);
  useEffect(() => {
    let alive = true;
    api.memRank().then((r) => alive && (setRank(r), setErr(null))).catch((e) => alive && setErr(e.message));
    return () => { alive = false; };
  }, [ctx.tick]);
  const mark = async (id, m) => { try { setRank(await api.memMark(id, m)); } catch (e) { setErr(e.message); } };

  const items = rank?.items ?? [];
  const depts = useMemo(() => [...new Set(items.map((x) => x.dept).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko')), [items]);
  const needle = q.trim().toLowerCase();
  const pass = (x) => (!family || famOf(x.origin) === family) && (!origin || x.origin === origin) && (!dept || x.dept === dept)
    && (!needle || `${x.title} ${x.id} ${x.dept ?? ''} ${x.unit ?? ''}`.toLowerCase().includes(needle));
  const inLayer = (x) => (layer === '필요' ? NEEDED.includes(x.layer) : x.layer === layer);
  const shown = items.filter((x) => inLayer(x) && pass(x))
    .sort(sort === 'time' ? (a, b) => String(b.time ?? '').localeCompare(String(a.time ?? '')) : (a, b) => b.score - a.score);
  const scope = items.filter(inLayer);      // 출처 막대는 고른 층 안에서 센다
  const total = items.length;
  const needCount = items.filter((x) => NEEDED.includes(x.layer)).length;
  const filtered = family || origin || dept || needle;

  return (
    <div className="mhome mrank">
      <div className="mhome-head">
        <h2>기억 정리</h2>
        <p>쌓인 기억 {total.toLocaleString()}개를 <b>필요한 것</b>과 <b>그냥 남은 기록</b>으로 나누고, 어떻게 쌓였는지 함께 보여 줘요. 무게는 종류·내 손길·내용 분량·참조·최근성으로 매기고, 줄을 펼치면 까닭이 보여요.</p>
      </div>

      <div className="mlayers" role="tablist" aria-label="기억 층">
        <button role="tab" className={`mlayer need ${layer === '필요' ? 'on' : ''}`} onClick={() => setLayer('필요')}>
          <span className="mlayer-k">필요한 것</span>
          <b className="mono">{needCount}</b>
          <span className="mlayer-d">지금 · 기준 · 결과</span>
          <span className="mlayer-bar"><i style={{ width: `${total ? (needCount / total) * 100 : 0}%` }} /></span>
        </button>
        {LAYERS.map((l) => {
          const n = rank?.totals.layer[l.key] ?? 0;
          return (
            <button key={l.key} role="tab" className={`mlayer l-${l.key} ${layer === l.key ? 'on' : ''}`} onClick={() => setLayer(l.key)} title={l.desc}>
              <span className="mlayer-k">{l.key}<em>{l.hint}</em></span>
              <b className="mono">{n}</b>
              <span className="mlayer-d">{l.desc}</span>
              <span className="mlayer-bar"><i style={{ width: `${total ? (n / total) * 100 : 0}%` }} /></span>
            </button>
          );
        })}
      </div>

      <div className="mhome-cols">
        <section className="mhome-main">
          <div className="mtools">
            <div className="mtools-q">
              <Icon name="search" size={13} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="이름·ID·부서로 찾기" spellCheck={false} aria-label="기억 찾기" />
            </div>
            <select value={dept} onChange={(e) => setDept(e.target.value)} aria-label="부서">
              <option value="">모든 부서</option>
              {depts.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            <div className="seg sm">
              <button className={sort === 'score' ? 'on' : ''} onClick={() => setSort('score')}>무게순</button>
              <button className={sort === 'time' ? 'on' : ''} onClick={() => setSort('time')}>최근순</button>
            </div>
            {filtered && <button className="linkbtn" onClick={() => { setFamily(null); setOrigin(null); setDept(''); setQ(''); }}>거르기 풀기</button>}
          </div>

          {err && <div className="emptybox"><Icon name="clock" size={18} /><div><b>기억 정리를 못 불러왔어요</b><p>{/없는 경로|404/.test(err) ? '두뇌 서버를 다시 시작하면 보여요 (새로 생긴 기능이라 서버가 아직 모름).' : err}</p></div></div>}
          {!rank && !err && <div className="empty-line">— 불러오는 중</div>}
          {rank && (layer === '필요'
            ? NEEDED.map((k) => <LayerGroup key={k} k={k} list={shown.filter((x) => x.layer === k)} ctx={ctx} onMark={mark} limit={k === '지금' ? 8 : 6} flat={!!origin || family === 'ses'} />)
            : <LayerGroup k={layer} list={shown} ctx={ctx} onMark={mark} limit={layer === '흔적' ? 12 : 30} solo flat={!!origin || family === 'ses'} />)}
          {rank && !shown.length && <div className="emptybox"><Icon name="filter" size={18} /><div><b>맞는 기억이 없어요</b><p>거르기를 풀거나 다른 층을 골라 보세요.</p></div></div>}
          {layer === '흔적' && <Timeline ctx={ctx} />}
        </section>

        <aside className="mhome-side">
          <div className="mbox">
            <div className="mbox-h"><b>어떻게 쌓였나</b><span className="grow" /><span className="mono">{scope.length}</span></div>
            <p className="mbox-sub">{layer === '필요' ? '필요한 것' : layer} 안에서 출처별로 셌어요. 누르면 그것만 봐요.</p>
            {FAMILY.map((f) => {
              const fl = scope.filter((x) => famOf(x.origin) === f.key);
              return (
                <div key={f.key} className={`mfam f-${f.key}`}>
                  <button className={`mfam-h ${family === f.key && !origin ? 'on' : ''}`} onClick={() => { setOrigin(null); setFamily((v) => (v === f.key ? null : f.key)); }} title={f.desc}>
                    <i /><b>{f.label}</b><span className="grow" /><span className="mono">{fl.length}</span>
                  </button>
                  <div className="mfam-bar"><i style={{ width: `${scope.length ? (fl.length / scope.length) * 100 : 0}%` }} /></div>
                  {f.origins.map((o) => {
                    const n = fl.filter((x) => x.origin === o).length;
                    if (!n) return null;
                    return (
                      <button key={o} className={`mfam-o ${origin === o ? 'on' : ''}`} onClick={() => { setFamily(null); setOrigin((v) => (v === o ? null : o)); }} title={ORIGIN_HINT[o]}>
                        <span>{o}</span><em className="mono">{n}</em>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>

          <div className="mbox">
            <div className="mbox-h"><b>무게는 이렇게</b></div>
            <ul className="mrule">
              <li><Meter n={3} /><span><b>중요</b> 60 이상 — 먼저 볼 것</span></li>
              <li><Meter n={2} /><span><b>참고</b> 35~59 — 필요할 때 찾아볼 것</span></li>
              <li><Meter n={1} /><span><b>가벼움</b> 35 미만 — 남겨만 둔 것</span></li>
            </ul>
            <p className="mbox-sub">종류 기본값에 더하고 빼요 — 내가 시킴·결정 +, 내용이 길수록 +, 다른 문서가 가리킬수록 +, 내 차례면 +, 오래 안 건드리면 −. 틀리면 줄을 펼쳐 <b>핵심으로 고정</b>하거나 <b>흔적으로 내리기</b> — 기억/분류.json에 남아요.</p>
          </div>

          <RecentTrace ctx={ctx} onAll={() => setLayer('흔적')} />
          {setTab && <button className="btn sm" onClick={() => setTab('graph')}><Icon name="graph" size={12} />그래프로 연결 보기</button>}
        </aside>
      </div>
    </div>
  );
}

function Meter({ n }) {
  return <span className={`mmeter m${n}`} aria-label={WEIGHT[n]}><i /><i /><i /></span>;
}

// 층 하나: 머리(이름·뜻·개수) + 줄들 (limit개까지, 더 보기).
//   바깥 세션을 따라 적은 작업은 수가 많고 비슷해서 "바깥 세션 대화 N개" 한 줄로 접고, 펼치면 부서·하위별로
function LayerGroup({ k, list, ctx, onMark, limit, solo = false, flat = false }) {
  const [all, setAll] = useState(false);
  const [outOpen, setOutOpen] = useState(false);
  const meta = LAYERS.find((l) => l.key === k);
  if (!list.length && !solo) return null;
  const outside = flat ? [] : list.filter((x) => x.origin === '따라 적음');
  const own = flat ? list : list.filter((x) => x.origin !== '따라 적음');
  const rows = all ? own : own.slice(0, limit);
  const byPlace = [...outside.reduce((m, x) => {
    const key = x.dept ? `${x.dept}${x.unit ? ` / ${x.unit}` : ''}` : '부서 없음';
    return m.set(key, [...(m.get(key) ?? []), x]);
  }, new Map())].sort((a, b) => b[1].length - a[1].length);
  return (
    <div className={`mgroup l-${k}`}>
      <div className="mgroup-h">
        <i /><b>{k}</b><span>{meta?.hint}</span><span className="mono">{list.length}</span>
        <span className="grow" /><span className="mgroup-d">{meta?.desc}</span>
      </div>
      {rows.map((x) => <RankRow key={x.id} x={x} ctx={ctx} onMark={onMark} />)}
      {own.length > limit && <button className="linkbtn mgroup-more" onClick={() => setAll((v) => !v)}>{all ? '접기' : `${own.length - limit}개 더 보기`}</button>}
      {outside.length > 0 && (
        <div className={`mouts ${outOpen ? 'open' : ''}`}>
          <button className="mouts-h" onClick={() => setOutOpen((v) => !v)} title={ORIGIN_HINT['따라 적음']}>
            <Icon name="chev" size={11} className={`chev ${outOpen ? 'open' : ''}`} />
            <b>바깥 세션 대화 {outside.length}개</b>
            <span>다른 곳(Claude 앱·코드)에서 한 대화를 두뇌가 따라 적은 것</span>
            <span className="grow" />
            <span className="mouts-places">{byPlace.slice(0, 3).map(([pl, l]) => `${pl} ${l.length}`).join(' · ')}{byPlace.length > 3 ? ' …' : ''}</span>
          </button>
          {outOpen && byPlace.map(([pl, l]) => (
            <div key={pl} className="mouts-g">
              <div className="mouts-gh">{pl} <span className="mono">{l.length}</span></div>
              {l.map((x) => <RankRow key={x.id} x={x} ctx={ctx} onMark={onMark} />)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// 기억 한 줄: 무게 막대 · 이름(+부서·종류·상태) · 출처 · 분량 · 때 — 펼치면 까닭과 고치기
function RankRow({ x, ctx, onMark }) {
  const [open, setOpen] = useState(false);
  const st = ctx.state.tasks.find((t) => t.id === x.id)?.status ?? x.status;
  const stLabel = STATUS[st]?.label;
  const n = bars(x.score);
  return (
    <div className={`mitem w${n} ${open ? 'open' : ''} ${x.mark ? 'marked' : ''}`}>
      <div className="mitem-row">
        <button className="mitem-w" onClick={() => setOpen((v) => !v)} title={`무게 ${x.score} — 눌러서 까닭 보기`} aria-expanded={open}>
          <Meter n={n} /><span className="mono">{x.score}</span>
        </button>
        <button className="mitem-main" onClick={(e) => ctx.pick(x.id, e)} title={`${x.id} — 누르면 오른쪽에 열려요`}>
          <span className="mitem-t">{x.mark === '핵심' && <Icon name="target" size={12} />}{x.title}</span>
          <span className="mitem-m">
            <i style={{ '--c': ctx.deptColor[x.dept] ?? 'var(--line-3)' }} />
            {x.dept ? `${x.dept}${x.unit ? ` / ${x.unit}` : ''}` : '모든 부서'}
            <span>· {TYPE_LABEL[x.type] ?? x.type}</span>
            {stLabel && <span className={`tag ${STATUS[st]?.tone ?? ''}`}>{stLabel}</span>}
          </span>
        </button>
        <span className={`morigin f-${famOf(x.origin)}`} title={ORIGIN_HINT[x.origin]}>{x.origin}</span>
        <span className={`msize s-${x.sizeLabel.replace(' ', '')}`} title={`읽을 만한 글자 ${x.size.toLocaleString()}자${x.type === '작업' ? ' (결과 칸)' : ''}`}>{x.sizeLabel}</span>
        <time className="mono" title={x.time ?? ''}>{shortTime(x.time)}</time>
      </div>
      {open && (
        <div className="mitem-why">
          <ul>
            {x.reasons.map((r, i) => (
              <li key={i}><em className={`mono ${r.n > 0 ? 'p' : r.n < 0 ? 'm' : ''}`}>{r.n > 0 ? `+${r.n}` : r.n < 0 ? r.n : '·'}</em><span>{r.why}</span></li>
            ))}
          </ul>
          <div className="mitem-facts">
            {x.refs > 0 && <span>다른 문서 {x.refs}곳이 가리킴</span>}
            {x.said > 0 && <span>내가 {x.said}번 말함</span>}
            {x.inLogs > 0 && <span>기록에 {x.inLogs}번 나옴</span>}
            {x.created && <span>처음 {String(x.created).replace('T', ' ')}</span>}
          </div>
          <div className="mitem-act">
            {x.mark !== '핵심' && <button className="btn sm" onClick={() => onMark(x.id, '핵심')}><Icon name="target" size={12} />핵심으로 고정</button>}
            {x.mark !== '흔적' && <button className="btn sm" onClick={() => onMark(x.id, '흔적')}><Icon name="x" size={12} />흔적으로 내리기</button>}
            {x.mark && <button className="btn sm ghost" onClick={() => onMark(x.id, null)}>원래대로</button>}
          </div>
        </div>
      )}
    </div>
  );
}

// 오른쪽 아래: 최근 이틀 흔적 (말·판정 원문) — 한꺼번에 쌓인 것은 묶음
function RecentTrace({ ctx, onAll }) {
  const [data, setData] = useState(null);
  useEffect(() => { let alive = true; api.memory({ days: 2 }).then((d) => alive && setData(d)).catch(() => alive && setData(null)); return () => { alive = false; }; }, [ctx.tick]);
  const entries = (data?.days ?? []).flatMap((d) => d.entries).filter((e) => e.source === '주인말').slice(0, 6);
  return (
    <div className="mbox">
      <div className="mbox-h"><b>최근 내가 한 말</b><span className="grow" /><button className="linkbtn" onClick={onAll}>흔적 전체</button></div>
      {!data ? <div className="empty-line">— 불러오는 중</div> : !entries.length ? <div className="empty-line">— 최근 이틀 없음</div>
        : <MemoryLog entries={entries} refs={data.refs} ctx={ctx} dense />}
    </div>
  );
}

// 흔적 층: 날짜별 원문 시간줄 (주인 말·검수 판정·세션 지시)
function Timeline({ ctx }) {
  const [want, setWant] = useState(7);
  const [data, setData] = useState(null);
  const [src, setSrc] = useState('all');
  useEffect(() => {
    let alive = true;
    api.memory({ days: want }).then((d) => alive && setData(d)).catch((e) => alive && setData({ days: [], refs: {}, error: e.message }));
    return () => { alive = false; };
  }, [want, ctx.tick]);
  const shown = (data?.days ?? []).map((d) => ({ ...d, entries: src === 'all' ? d.entries : d.entries.filter((e) => e.source === src) })).filter((d) => d.entries.length);
  return (
    <div className="mtimeline">
      <div className="mhome-bar">
        <h3>날짜별 원문</h3>
        <div className="seg sm">
          {[['all', '전체'], ['주인말', '주인 말'], ['검수판정', '검수 판정'], ['세션지시', '세션 지시']].map(([k, l]) => (
            <button key={k} className={src === k ? 'on' : ''} onClick={() => setSrc(k)}>{l}</button>
          ))}
        </div>
      </div>
      {data == null ? <div className="empty-line">— 불러오는 중</div>
        : data.error ? <div className="emptybox"><Icon name="clock" size={18} /><div><b>기록을 못 불러왔어요</b><p>{data.error}</p></div></div>
        : !shown.length ? <div className="empty-line">— 아직 쌓인 기록이 없어요</div>
        : shown.map((d) => (
          <div key={d.date} className="mday">
            <div className="mday-h">
              <b>{dayLabel(d.date)}</b>
              <span className="mono">{d.entries.length}</span>
              <span className="grow" />
              {d.files.filter((f) => src === 'all' || f.type === src).map((f) => (
                <button key={f.name} className="linkbtn" onClick={(e) => ctx.pick(f.name, e)} title={`${f.name}.md`}>{SOURCE_LABEL[f.type]} 원문</button>
              ))}
            </div>
            <MemoryLog entries={d.entries} refs={data.refs} ctx={ctx} />
          </div>
        ))}
      {data && data.days.length >= want && <button className="btn sm mhome-more" onClick={() => setWant((n) => n + 7)}>이전 기록 더 보기</button>}
    </div>
  );
}
