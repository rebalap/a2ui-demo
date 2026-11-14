/**
 * The app around the A2UI surfaces: header, step tracker, chat, receipt picker,
 * manager phone and the inspector. All of this is ordinary app code. The cards
 * inside the chat and on the phone are A2UI, composed by the agent.
 */
import {useEffect, useMemo, useRef, useState, useSyncExternalStore} from 'react';
import {A2uiSurface, MarkdownContext} from '@a2ui/react';
import MarkdownIt from 'markdown-it';

import {Icon} from './icons';
import {Surfaces} from './surfaces';

const md = new MarkdownIt({html: false, linkify: false});
const renderMarkdown = async (s: string) => md.render(s ?? '');

interface Receipt { id: string; merchant: string; total: string; hint: string }
interface Meta { mode: 'gemini' | 'scripted'; model: string; receipts: Receipt[]; employee: {name: string; manager: string} }
interface Entry { role: 'user' | 'agent'; text: string; surfaceId?: string; note?: string }
interface Inspect {
  modelSaw?: string;
  bindablePaths?: string;
  hostFilled?: Record<string, unknown>;
  express?: string;
  messages?: unknown[];
  errors: string[];
}

const SESSION = Math.random().toString(36).slice(2);
const STEPS = ['Scan', 'Review', 'Approval', 'Done'];
const HINTS = [
  'Pick a receipt to scan. The agent answers with an interface.',
  'Check the card, add a business purpose, then submit.',
  'Over to the manager: approve or reject on the phone.',
  'Done. Pick another receipt to run it again.',
];
const initials = (name?: string) => (name ?? '').split(' ').map(p => p[0]).join('').slice(0, 2);

function SurfaceView({surfaces, id}: {surfaces: Surfaces; id: string}) {
  useSyncExternalStore(surfaces.subscribe, surfaces.getVersion);
  const surface = surfaces.get(id);
  if (!surface) return null;
  return (
    <div className="ex-surface" data-surface={id}>
      <A2uiSurface surface={surface} />
    </div>
  );
}

export default function App() {
  const surfaces = useMemo(() => new Surfaces(), []);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [manager, setManager] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState('');
  const [tab, setTab] = useState<'privacy' | 'wire'>('privacy');
  const [inspect, setInspect] = useState<Inspect>({errors: []});
  const [toast, setToast] = useState<string | null>(null);
  const [stage, setStage] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const lastAction = useRef<string | null>(null);
  const chatEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/meta').then(r => r.json()).then(setMeta).catch(() => setMeta(null));
  }, []);
  // Follow the conversation, including cards that grow as the host fills their data.
  const surfaceVersion = useSyncExternalStore(surfaces.subscribe, surfaces.getVersion);
  useEffect(() => {
    const t = setTimeout(() => {
      const box = chatEnd.current?.parentElement;
      if (box) box.scrollTo({top: box.scrollHeight, behavior: 'smooth'});
    }, 60);
    return () => clearTimeout(t);
  }, [entries, surfaceVersion]);

  async function send(body: Record<string, unknown>, label?: string) {
    if (busy) return;
    setBusy(true);
    setEntries(e => [...e, ...(label ? [{role: 'user' as const, text: label}] : []), {role: 'agent', text: ''}]);
    const errors: string[] = [];
    try {
      const res = await fetch('/api/turn', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({sessionId: SESSION, ...body}),
      });
      if (!res.ok || !res.body) throw new Error(`Server said ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const {value, done} = await reader.read();
        if (done) break;
        buf += decoder.decode(value, {stream: true});
        let cut;
        while ((cut = buf.indexOf('\n\n')) >= 0) {
          const line = buf.slice(0, cut);
          buf = buf.slice(cut + 2);
          if (line.startsWith('data: ')) handle(JSON.parse(line.slice(6)), errors);
        }
      }
    } catch (err) {
      errors.push(String(err));
      appendText(`\n\n_Something went wrong: ${String(err)}_`);
    } finally {
      setInspect(i => ({...i, errors}));
      setBusy(false);
    }
  }

  function appendText(t: string) {
    setEntries(e => {
      const last = e[e.length - 1];
      return [...e.slice(0, -1), {...last, text: last.text + t}];
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function handle(ev: any, errors: string[]) {
    switch (ev.type) {
      case 'context':
        setInspect({modelSaw: ev.modelSaw, bindablePaths: ev.bindablePaths, hostFilled: ev.hostFilled, errors: []});
        break;
      case 'text':
        appendText(ev.text);
        break;
      case 'ui': {
        surfaces.apply(ev.messages);
        for (const m of ev.messages) {
          const id: string | undefined = m.createSurface?.surfaceId;
          if (!id) continue;
          if (id.startsWith('approval')) {
            setManager(id);
            setToast(`New request from ${meta?.employee.name ?? 'an employee'}`);
            setTimeout(() => setToast(null), 3500);
            setEntries(e => {
              const last = e[e.length - 1];
              return [...e.slice(0, -1), {...last, note: 'Sent to the manager’s phone'}];
            });
          } else {
            // A submit that drew no approval card was filed straight away.
            if (lastAction.current === 'submit') setStage(3);
            setEntries(e => {
              const last = e[e.length - 1];
              return [...e.slice(0, -1), {...last, surfaceId: id}];
            });
          }
        }
        break;
      }
      case 'wire':
        setInspect(i => ({...i, express: ev.express, messages: ev.messages}));
        break;
      case 'error':
        errors.push(ev.message);
        break;
    }
  }

  surfaces.onPress = action => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a = action as any;
    lastAction.current = a.name;
    if (a.name === 'submit') setStage(2);
    if (a.name === 'approve' || a.name === 'reject') setStage(3);
    const boss = meta?.employee.manager ?? 'Manager';
    const label = a.name === 'submit' ? 'Submitted the expense' : a.name === 'approve' ? `${boss} approved` : a.name === 'reject' ? `${boss} rejected` : `Pressed ${a.name}`;
    void send({action: a}, label);
  };

  function pickReceipt(r: Receipt) {
    if (busy) return;
    surfaces.clear();
    setManager(null);
    setEntries([]);
    setStage(1);
    setPicked(r.id);
    lastAction.current = null;
    void send({receiptId: r.id}, `Scanned ${r.merchant.split(',')[0]} · ${r.total}`);
  }

  return (
    <MarkdownContext.Provider value={renderMarkdown}>
      <div className="ex-app">
        <header className="ex-top">
          <div className="ex-brand">
            <span className="ex-logo" aria-hidden><Icon name="spark" size={18} /></span>
            <div>
              <strong>Expense Copilot</strong>
              <span>An A2UI 1.0 demo</span>
            </div>
          </div>

          <ol className="ex-steps" aria-label="Progress">
            {STEPS.map((s, i) => (
              <li key={s} className={i < stage ? 'is-done' : i === stage ? 'is-now' : ''} aria-current={i === stage ? 'step' : undefined}>
                <span className="ex-steps__dot">{i < stage ? <Icon name="check" size={12} strokeWidth={3} /> : i + 1}</span>
                {s}
              </li>
            ))}
          </ol>

          <span className={`ex-mode ex-mode--${meta?.mode ?? 'scripted'}`}>
            <i aria-hidden />
            {meta ? (meta.mode === 'gemini' ? `Live · ${meta.model}` : 'Scripted agent') : 'Connecting…'}
          </span>
        </header>

        <div className="ex-hint" role="status"><Icon name="spark" size={14} /> {HINTS[stage]}</div>

        <main className="ex-grid">
          <section className="ex-pane ex-chat" aria-label="Employee view">
            <div className="ex-pane__title">
              <span className="ex-avatar ex-avatar--sm" aria-hidden>{initials(meta?.employee.name)}</span>
              <span className="ex-who">{meta?.employee.name ?? 'Employee'}</span>
              <span className="ex-tag">Employee · web</span>
            </div>
            <div className="ex-picker">
              {meta?.receipts.map(r => (
                <button
                  key={r.id}
                  type="button"
                  className={`ex-receipt-tile ${picked === r.id ? 'is-picked' : ''}`}
                  disabled={busy}
                  onClick={() => pickReceipt(r)}
                >
                  <span className="ex-receipt-tile__icon"><Icon name={r.id} size={18} /></span>
                  <span className="ex-receipt-tile__text">
                    <strong>{r.merchant.split(',')[0]}</strong>
                    <em>{r.hint}</em>
                  </span>
                  <span className="ex-receipt-tile__total">{r.total}</span>
                </button>
              ))}
            </div>
            <div className="ex-messages">
              {entries.length === 0 ? (
                <div className="ex-empty">
                  <span className="ex-empty__icon"><Icon name="receipt" size={28} /></span>
                  <h2>Scan a receipt</h2>
                  <p>The agent replies with an <strong>interface</strong>, not a paragraph, built from this app’s own components.</p>
                </div>
              ) : null}
              {entries.map((e, i) => (
                <div key={i} className={`ex-msg ex-msg--${e.role}`}>
                  {e.text || (e.role === 'agent' && busy && i === entries.length - 1 && !e.surfaceId) ? (
                    <div className="ex-msg__row">
                      {e.role === 'agent' ? <span className="ex-bot" aria-hidden><Icon name="spark" size={14} /></span> : null}
                      <div className="ex-bubble">{e.text || <span className="ex-typing" aria-label="Thinking"><i /><i /><i /></span>}</div>
                    </div>
                  ) : null}
                  {e.surfaceId ? <SurfaceView surfaces={surfaces} id={e.surfaceId} /> : null}
                  {e.note ? <div className="ex-note"><Icon name="send" size={13} /> {e.note}</div> : null}
                </div>
              ))}
              <div ref={chatEnd} />
            </div>
            <form
              className="ex-compose"
              onSubmit={ev => {
                ev.preventDefault();
                if (!draft.trim()) return;
                void send({text: draft.trim()}, draft.trim());
                setDraft('');
              }}
            >
              <input value={draft} onChange={e => setDraft(e.target.value)} placeholder="Ask the copilot…" disabled={busy} aria-label="Message the copilot" />
              <button type="submit" className="ex-btn ex-btn--primary ex-btn--icon" disabled={busy || !draft.trim()} aria-label="Send">
                <Icon name="send" size={16} />
              </button>
            </form>
          </section>

          <section className="ex-pane ex-phone-pane" aria-label="Manager view">
            <div className="ex-pane__title">
              <span className="ex-avatar ex-avatar--sm ex-avatar--alt" aria-hidden>{initials(meta?.employee.manager)}</span>
              <span className="ex-who">{meta?.employee.manager ?? 'Manager'}</span>
              <span className="ex-tag">Manager · phone</span>
            </div>
            <div className="ex-phone">
              <div className="ex-phone__island" aria-hidden />
              <div className="ex-phone__status"><span>9:41</span><span>Approvals</span><span className="ex-phone__bat" aria-hidden /></div>
              {toast ? <div className="ex-toast" role="status"><span className="ex-toast__app"><Icon name="spark" size={12} /></span><div><strong>Expense Copilot</strong>{toast}</div></div> : null}
              <div className="ex-phone__screen">
                {manager ? <SurfaceView surfaces={surfaces} id={manager} /> : (
                  <div className="ex-phone__empty"><Icon name="inbox" size={30} /><p>All caught up</p><span>Approval requests show up here.</span></div>
                )}
              </div>
              <div className="ex-phone__home" aria-hidden />
            </div>
            <p className="ex-caption">Same agent, same protocol. The approval card lands here because the agent addressed a different surface.</p>
          </section>

          <section className="ex-pane ex-inspector" aria-label="Inspector">
            <div className="ex-tabs" role="tablist">
              <button role="tab" aria-selected={tab === 'privacy'} className={tab === 'privacy' ? 'is-on' : ''} onClick={() => setTab('privacy')}><Icon name="eye" size={15} /> What the model saw</button>
              <button role="tab" aria-selected={tab === 'wire'} className={tab === 'wire' ? 'is-on' : ''} onClick={() => setTab('wire')}><Icon name="code" size={15} /> Wire</button>
            </div>
            {tab === 'privacy' ? (
              <div className="ex-inspect">
                {!inspect.modelSaw ? <div className="ex-inspect__empty"><Icon name="eye" size={26} /><p>Run a turn to see exactly what the model was given.</p></div> : (
                  <>
                    <h4>The model’s input this turn</h4>
                    <pre className="ex-code">{inspect.modelSaw}</pre>
                    <h4><Icon name="lock" size={13} /> Filled in by the server, never sent to the model</h4>
                    <div className="ex-vault">
                      {Object.entries(inspect.hostFilled ?? {}).map(([p, v]) => (
                        <div key={p} className="ex-vault__row"><code>${p}</code><span>{String(v)}</span></div>
                      ))}
                    </div>
                    <p className="ex-muted">The model writes <code>paidWith=$/employee/card</code>. The server sends the real value straight to the renderer in an <code>updateDataModel</code> message.</p>
                  </>
                )}
              </div>
            ) : (
              <div className="ex-inspect">
                {!inspect.express ? <div className="ex-inspect__empty"><Icon name="code" size={26} /><p>Run a turn to see the wire.</p></div> : (
                  <>
                    <h4>What the model wrote <span className="ex-tag">A2UI Express</span></h4>
                    <pre className="ex-code">{inspect.express}</pre>
                    <h4>What the client received <span className="ex-tag">A2UI v1.0 JSON</span></h4>
                    <pre className="ex-code ex-code--json">{JSON.stringify(inspect.messages, null, 2)}</pre>
                  </>
                )}
                {inspect.errors.length ? (
                  <>
                    <h4>Errors this turn</h4>
                    <pre className="ex-code ex-code--err">{inspect.errors.join('\n\n')}</pre>
                  </>
                ) : null}
              </div>
            )}
          </section>
        </main>
      </div>
    </MarkdownContext.Provider>
  );
}
