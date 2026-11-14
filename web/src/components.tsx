/**
 * The four expense components the agent may place. Each is ordinary React: the
 * SDK hands it resolved props (bindings already filled from the data model,
 * actions as functions) and redraws it when a bound value changes.
 */
import type {CSSProperties, FC} from 'react';

type Props = Record<string, unknown>;
interface ViewProps {
  props: Props;
}

const text = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v) || 0);
const rows = (v: unknown): Props[] => (Array.isArray(v) ? v.filter((x): x is Props => !!x && typeof x === 'object') : []);
const act = (v: unknown) => (typeof v === 'function' ? (v as () => unknown) : null);
const money = (v: number) => `$${v.toLocaleString('en-US', {minimumFractionDigits: 0, maximumFractionDigits: 0})}`;

function aria(props: Props, role?: string) {
  const a = (props['accessibility'] ?? {}) as Props;
  return {
    role,
    'aria-label': a['label'] ? text(a['label']) : undefined,
    'aria-description': a['description'] ? text(a['description']) : undefined,
    'aria-live': a['live'] && a['live'] !== 'off' ? (a['live'] as 'polite' | 'assertive') : undefined,
    'aria-hidden': a['hidden'] === true ? true : undefined,
  };
}

/** A value the host is still filling shows as a shimmer, not as blank. */
function Bound({value, width = 80}: {value: unknown; width?: number}) {
  const s = text(value);
  return s ? <>{s}</> : <span className="ex-shimmer" style={{width}} aria-hidden />;
}

export function ReceiptCard({props}: ViewProps) {
  const items = rows(props['items']);
  return (
    <article className="ex-receipt" {...aria(props, 'group')}>
      <header>
        <div>
          <span className="ex-eyebrow">{text(props['category']) || 'Receipt'}</span>
          <h3><Bound value={props['merchant']} width={160} /></h3>
          <span className="ex-muted"><Bound value={props['date']} width={110} /></span>
        </div>
        <strong className="ex-amount"><Bound value={props['total']} width={70} /></strong>
      </header>
      {items.length ? (
        <ul className="ex-lines">
          {items.map((it, i) => (
            <li key={i}>
              <span>{text(it['label'])}</span>
              <span className="ex-dots" aria-hidden />
              <span>{text(it['amount'])}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {props['paidWith'] !== undefined ? (
        <footer className="ex-paid">
          <span className="ex-chip-icon" aria-hidden>▭</span>
          Paid with <strong><Bound value={props['paidWith']} width={150} /></strong>
          <span className="ex-private" title="Filled in by the server. The model never saw this value.">🔒 server-filled</span>
        </footer>
      ) : null}
    </article>
  );
}

const STATUS_ICON: Record<string, string> = {ok: '✓', warning: '!', blocked: '✕'};

export function PolicyCheck({props}: ViewProps) {
  const status = text(props['status']) || 'ok';
  return (
    <div className={`ex-policy ex-policy--${status}`} {...aria(props, 'status')}>
      <span className="ex-policy__icon" aria-hidden>{STATUS_ICON[status] ?? '•'}</span>
      <div>
        <strong>{text(props['title'])}</strong>
        {props['detail'] ? <p>{text(props['detail'])}</p> : null}
      </div>
    </div>
  );
}

export function BudgetMeter({props}: ViewProps) {
  const spent = num(props['spent']);
  const limit = Math.max(num(props['limit']), 1);
  const pending = num(props['pending']);
  const pct = (v: number) => `${Math.min(100, Math.max(0, (v / limit) * 100))}%`;
  const over = spent + pending > limit;
  const left = limit - spent;
  return (
    <div className="ex-budget" {...aria(props, 'group')}>
      <div className="ex-budget__head">
        <span><Bound value={props['label']} width={160} /></span>
        <span className={over ? 'ex-bad' : 'ex-muted'}>
          {props['limit'] === undefined ? <Bound value="" /> : `${money(left)} left of ${money(limit)}`}
        </span>
      </div>
      <div className="ex-bar" role="meter" aria-valuemin={0} aria-valuemax={limit} aria-valuenow={spent}>
        <span className="ex-bar__spent" style={{width: pct(spent)}} />
        {pending ? (
          <span
            className={`ex-bar__pending ${over ? 'is-over' : ''}`}
            style={{left: pct(spent), width: pct(pending)} as CSSProperties}
          />
        ) : null}
      </div>
      {pending ? (
        <div className="ex-budget__legend">
          <span><i className="ex-key ex-key--spent" /> Spent {money(spent)}</span>
          <span><i className={`ex-key ex-key--pending ${over ? 'is-over' : ''}`} /> This expense {money(pending)}</span>
        </div>
      ) : null}
    </div>
  );
}

export function ApprovalCard({props}: ViewProps) {
  const status = text(props['status']) || 'pending';
  const approve = act(props['approveAction']);
  const reject = act(props['rejectAction']);
  const flags = rows(props['flags']);
  const decided = status === 'approved' || status === 'rejected';
  return (
    <article className={`ex-approval is-${status}`} {...aria(props, 'group')}>
      <header>
        <span className="ex-avatar" aria-hidden>{text(props['requester']).slice(0, 1) || '·'}</span>
        <div>
          <span className="ex-eyebrow">Approval request</span>
          <strong><Bound value={props['requester']} width={100} /></strong>
        </div>
        <span className={`ex-pill ex-pill--${status}`}>{status}</span>
      </header>
      <div className="ex-approval__amount"><Bound value={props['amount']} width={90} /></div>
      <p className="ex-approval__summary">{text(props['summary'])}</p>
      {props['justification'] !== undefined ? (
        <blockquote>“<Bound value={props['justification']} width={180} />”</blockquote>
      ) : null}
      {flags.length ? (
        <ul className="ex-flags">
          {flags.map((f, i) => <li key={i}>⚠ {text(f['text'])}</li>)}
        </ul>
      ) : null}
      <div className="ex-approval__actions">
        <button type="button" className="ex-btn ex-btn--ghost" disabled={decided || !reject} onClick={() => void reject?.()}>Reject</button>
        <button type="button" className="ex-btn ex-btn--primary" disabled={decided || !approve} onClick={() => void approve?.()}>Approve</button>
      </div>
    </article>
  );
}

export const EXPENSE_VIEWS: Record<string, FC<ViewProps>> = {ReceiptCard, PolicyCheck, BudgetMeter, ApprovalCard};
