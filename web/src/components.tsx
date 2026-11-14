/**
 * The four expense components the agent may place. Each is ordinary React: the
 * SDK hands it resolved props (bindings already filled from the data model,
 * actions as functions) and redraws it when a bound value changes.
 */
import type {CSSProperties, FC} from 'react';

import {Icon} from './icons';

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

const CATEGORY_ICON: Record<string, string> = {meals: 'dinner', 'client meal': 'dinner', dinner: 'dinner', travel: 'ride', transport: 'ride', ground: 'ride', lodging: 'hotel', hotel: 'hotel'};
const iconFor = (category: string) => {
  const c = category.toLowerCase();
  const hit = Object.keys(CATEGORY_ICON).find(k => c.includes(k));
  return hit ? CATEGORY_ICON[hit] : 'receipt';
};

export function ReceiptCard({props}: ViewProps) {
  const items = rows(props['items']);
  const category = text(props['category']) || 'Receipt';
  return (
    <article className="ex-receipt" {...aria(props, 'group')}>
      <header className="ex-receipt__head">
        <span className="ex-receipt__icon"><Icon name={iconFor(category)} size={20} /></span>
        <div className="ex-receipt__who">
          <span className="ex-eyebrow">{category}</span>
          <h3><Bound value={props['merchant']} width={160} /></h3>
          <span className="ex-muted"><Bound value={props['date']} width={110} /></span>
        </div>
        <strong className="ex-amount"><Bound value={props['total']} width={70} /></strong>
      </header>
      {items.length ? (
        <ul className="ex-lines">
          {items.map((it, i) => (
            <li key={i} style={{'--i': i} as CSSProperties}>
              <span>{text(it['label'])}</span>
              <span className="ex-dots" aria-hidden />
              <span className="ex-num">{text(it['amount'])}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {props['paidWith'] !== undefined ? (
        <footer className="ex-paid">
          <Icon name="card" size={16} />
          <span>Paid with <strong><Bound value={props['paidWith']} width={150} /></strong></span>
          <span className="ex-private" title="Filled in by the server. The model never saw this value.">
            <Icon name="lock" size={12} /> Server-filled
          </span>
        </footer>
      ) : null}
    </article>
  );
}

const STATUS_ICON: Record<string, string> = {ok: 'check', warning: 'alert', blocked: 'x'};

export function PolicyCheck({props}: ViewProps) {
  const status = text(props['status']) || 'ok';
  return (
    <div className={`ex-policy ex-policy--${status}`} {...aria(props, 'status')}>
      <span className="ex-policy__icon"><Icon name={STATUS_ICON[status] ?? 'check'} size={14} strokeWidth={2.4} /></span>
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
  const after = limit - spent - pending;
  const known = props['limit'] !== undefined;
  return (
    <div className={`ex-budget ${over ? 'is-over' : ''}`} {...aria(props, 'group')}>
      <div className="ex-budget__head">
        <div>
          <span className="ex-eyebrow"><Bound value={props['label']} width={140} /></span>
          <div className="ex-budget__big">
            {known ? (
              <>
                <strong>{over ? `−${money(-after)}` : money(after)}</strong>
                <span>{over ? 'over budget after this' : 'left after this'}</span>
              </>
            ) : <Bound value="" width={120} />}
          </div>
        </div>
        {known ? <span className="ex-budget__of">of {money(limit)}</span> : null}
      </div>
      <div className="ex-bar" role="meter" aria-valuemin={0} aria-valuemax={limit} aria-valuenow={spent + pending}>
        <span className="ex-bar__spent" style={{width: pct(spent)}} />
        {pending ? <span className="ex-bar__pending" style={{left: pct(spent), width: pct(pending)}} /> : null}
      </div>
      {pending ? (
        <div className="ex-budget__legend">
          <span><i className="ex-key ex-key--spent" /> Spent {money(spent)}</span>
          <span><i className="ex-key ex-key--pending" /> This expense {money(pending)}</span>
        </div>
      ) : null}
    </div>
  );
}

const STAMP: Record<string, string> = {approved: 'Approved', rejected: 'Rejected'};

export function ApprovalCard({props}: ViewProps) {
  const status = text(props['status']) || 'pending';
  const approve = act(props['approveAction']);
  const reject = act(props['rejectAction']);
  const flags = rows(props['flags']);
  const decided = status === 'approved' || status === 'rejected';
  const name = text(props['requester']);
  return (
    <article className={`ex-approval is-${status}`} {...aria(props, 'group')}>
      {STAMP[status] ? <div className="ex-stamp" aria-hidden>{STAMP[status]}</div> : null}
      <header>
        <span className="ex-avatar" aria-hidden>{name ? name.split(' ').map(p => p[0]).join('').slice(0, 2) : '·'}</span>
        <div>
          <strong><Bound value={props['requester']} width={100} /></strong>
          <span className="ex-muted">wants approval</span>
        </div>
        <span className={`ex-pill ex-pill--${status}`}>{status}</span>
      </header>
      <div className="ex-approval__amount"><Bound value={props['amount']} width={90} /></div>
      <p className="ex-approval__summary">{text(props['summary'])}</p>
      {props['justification'] !== undefined ? (
        <blockquote><span className="ex-eyebrow">Business purpose</span><Bound value={props['justification']} width={180} /></blockquote>
      ) : null}
      {flags.length ? (
        <ul className="ex-flags">
          {flags.map((f, i) => <li key={i}><Icon name="alert" size={13} /> {text(f['text'])}</li>)}
        </ul>
      ) : null}
      <div className="ex-approval__actions">
        <button type="button" className="ex-btn ex-btn--ghost" disabled={decided || !reject} onClick={() => void reject?.()}>
          <Icon name="x" size={16} /> Reject
        </button>
        <button type="button" className="ex-btn ex-btn--primary" disabled={decided || !approve} onClick={() => void approve?.()}>
          <Icon name="check" size={16} /> Approve
        </button>
      </div>
    </article>
  );
}

export const EXPENSE_VIEWS: Record<string, FC<ViewProps>> = {ReceiptCard, PolicyCheck, BudgetMeter, ApprovalCard};
