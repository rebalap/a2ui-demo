/**
 * The app around the A2UI surfaces: header, chat, receipt picker, manager phone
 * and the inspector. All of this is ordinary app code. The cards inside the
 * chat and on the phone are A2UI, composed by the agent.
 */
import {useEffect, useMemo, useRef, useState, useSyncExternalStore} from 'react';
import {A2uiSurface, MarkdownContext} from '@a2ui/react';
import MarkdownIt from 'markdown-it';

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
const RECEIPT_ICON: Record<string, string> = {dinner: '🍽', ride: '🚗', hotel: '🏨'};

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
  const chatEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/meta').then(r => r.json()).then(setMeta).catch(() => setMeta(null));
  }, []);
  useEffect(() => {
    // Braces matter: newer browsers return a Promise here, which React would take for a cleanup.
    void chatEnd.current?.scrollIntoView({behavior: 'smooth', block: 'end'});
  }, [entries]);

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
            setToast(`New approval request for ${meta?.employee.manager ?? 'the manager'}`);
            setTimeout(() => setToast(null), 3500);
            setEntries(e => {
              const last = e[e.length - 1];
              return [...e.slice(0, -1), {...last, note: '→ Sent to the manager’s phone'}];
            });
          } else {
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
    const label = a.name === 'submit' ? 'Submitted the expense' : a.name === 'approve' ? `${meta?.employee.manager ?? 'Manager'} approved` : a.name === 'reject' ? `${meta?.employee.manager ?? 'Manager'} rejected` : `Pressed ${a.name}`;
    void send({action: a}, label);
  };

  function pickReceipt(r: Receipt) {
    if (busy) return;
    surfaces.clear();
    setManager(null);
    setEntries([]);
    void send({receiptId: r.id}, `📎 Scanned a receipt: ${r.merchant}, ${r.total}`);
  }

  return (
    <MarkdownContext.Provider value={renderMarkdown}>
      <div className="ex-app">
        <header className="ex-top">
          <div className="ex-brand">
            <span className="ex-logo" aria-hidden>◆</span>
            <div>
              <strong>Expense Copilot</strong>
              <span>An A2UI 1.0 demo</span>
            </div>
          </div>
          <span className={`ex-mode ex-mode--${meta?.mode ?? 'scripted'}`}>
            {meta ? (meta.mode === 'gemini' ? `Live · ${meta.model}` : 'Scripted agent (no key)') : 'Connecting…'}
          </span>
        </header>

        <main className="ex-grid">
          <section className="ex-pane ex-chat" aria-label="Employee view">
            <div className="ex-pane__title">
              <span className="ex-who">{meta?.employee.name ?? 'Employee'}</span> · employee, web
            </div>
            <div className="ex-picker">
              <span className="ex-muted">Scan a receipt</span>
              <div className="ex-receipts">
                {meta?.receipts.map(r => (
                  <button key={r.id} type="button" className="ex-receipt-tile" disabled={busy} onClick={() => pickReceipt(r)}>
                    <span className="ex-receipt-tile__icon" aria-hidden>{RECEIPT_ICON[r.id] ?? '🧾'}</span>
                    <span><strong>{r.merchant.split(',')[0]}</strong><em>{r.total} · {r.hint}</em></span>
                  </button>
                ))}
              </div>
            </div>
            <div className="ex-messages">
              {entries.length === 0 ? (
                <div className="ex-empty">
                  <p>Pick a receipt. The agent answers with an <strong>interface</strong>, not a paragraph, drawn from this app’s own components.</p>
                </div>
              ) : null}
              {entries.map((e, i) => (
                <div key={i} className={`ex-msg ex-msg--${e.role}`}>
                  {e.text || (e.role === 'agent' && busy && i === entries.length - 1 && !e.surfaceId) ? (
                    <div className="ex-bubble">{e.text || <span className="ex-typing" aria-label="Thinking"><i /><i /><i /></span>}</div>
                  ) : null}
                  {e.surfaceId ? <SurfaceView surfaces={surfaces} id={e.surfaceId} /> : null}
                  {e.note ? <div className="ex-note">{e.note}</div> : null}
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
              <input value={draft} onChange={e => setDraft(e.target.value)} placeholder="Ask the copilot…" disabled={busy} />
              <button type="submit" className="ex-btn ex-btn--primary" disabled={busy || !draft.trim()}>Send</button>
            </form>
          </section>

          <section className="ex-pane ex-phone-pane" aria-label="Manager view">
            <div className="ex-pane__title">
              <span className="ex-who">{meta?.employee.manager ?? 'Manager'}</span> · manager, phone
            </div>
            <div className="ex-phone">
              <div className="ex-phone__notch" aria-hidden />
              <div className="ex-phone__status"><span>9:41</span><span>Approvals</span></div>
              {toast ? <div className="ex-toast" role="status">{toast}</div> : null}
              <div className="ex-phone__screen">
                {manager ? <SurfaceView surfaces={surfaces} id={manager} /> : (
                  <div className="ex-phone__empty"><span aria-hidden>📥</span><p>No requests waiting.</p></div>
                )}
              </div>
            </div>
            <p className="ex-caption">Same agent, same A2UI messages: the approval card is drawn here because the agent addressed a different surface.</p>
          </section>

          <section className="ex-pane ex-inspector" aria-label="Inspector">
            <div className="ex-tabs" role="tablist">
              <button role="tab" aria-selected={tab === 'privacy'} className={tab === 'privacy' ? 'is-on' : ''} onClick={() => setTab('privacy')}>What the model saw</button>
              <button role="tab" aria-selected={tab === 'wire'} className={tab === 'wire' ? 'is-on' : ''} onClick={() => setTab('wire')}>Wire</button>
            </div>
            {tab === 'privacy' ? (
              <div className="ex-inspect">
                {!inspect.modelSaw ? <p className="ex-muted">Run a turn to see exactly what the model was given.</p> : (
                  <>
                    <h4>The model’s input this turn</h4>
                    <pre className="ex-code">{inspect.modelSaw}</pre>
                    <h4>Filled in by the server, never sent to the model</h4>
                    <table className="ex-table">
                      <tbody>
                        {Object.entries(inspect.hostFilled ?? {}).map(([p, v]) => (
                          <tr key={p}><td><code>${p}</code></td><td>🔒 {String(v)}</td></tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="ex-muted">The model writes <code>paidWith=$/employee/card</code>. The server sends the real value straight to the renderer in an <code>updateDataModel</code> message.</p>
                  </>
                )}
              </div>
            ) : (
              <div className="ex-inspect">
                {!inspect.express ? <p className="ex-muted">Run a turn to see the wire.</p> : (
                  <>
                    <h4>What the model wrote (A2UI Express)</h4>
                    <pre className="ex-code">{inspect.express}</pre>
                    <h4>What the client received (A2UI v1.0 JSON)</h4>
                    <pre className="ex-code ex-code--json">{JSON.stringify(inspect.messages, null, 2)}</pre>
                  </>
                )}
                {inspect.errors.length ? (
                  <>
                    <h4>Refused by the catalog</h4>
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
