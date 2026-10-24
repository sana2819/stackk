import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity, ArrowDownLeft, ArrowUpRight, Check, ChevronDown, CircleDollarSign,
  Plus, ReceiptText, RefreshCw, Users, Wallet, X
} from "lucide-react";
import "./styles.css";

const rawApi = import.meta.env.VITE_API_URL || "";
const API = rawApi.replace(/\/+$/, "");
const currency = (value) => new Intl.NumberFormat("en-IN", {
  style: "currency", currency: "INR", maximumFractionDigits: 2
}).format(Number(value || 0));

async function request(path, options = {}) {
  const url = API ? `${API}${path}` : path;
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = body.detail;
    throw new Error(Array.isArray(detail) ? detail.map(x => x.msg).join(", ") : detail || "Something went wrong");
  }
  return body;
}

function App() {
  const [groups, setGroups] = useState([]);
  const [activeId, setActiveId] = useState("");
  const [group, setGroup] = useState(null);
  const [expenses, setExpenses] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showGroupForm, setShowGroupForm] = useState(false);
  const [showExpenseForm, setShowExpenseForm] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [memberNames, setMemberNames] = useState("SR, Alex, Sam");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [payerId, setPayerId] = useState("");

  async function loadGroups(preferredId = activeId) {
    const list = await request("/api/groups");
    setGroups(list);
    const chosen = list.find(g => String(g.id) === String(preferredId)) || list[0];
    setActiveId(chosen ? String(chosen.id) : "");
    return chosen || null;
  }

  async function loadGroup(id) {
    if (!id) {
      setGroup(null); setExpenses([]); setSummary(null); return;
    }
    const data = await request(`/api/groups/${id}`);
    setGroup(data);
    setExpenses(data.expenses || []);
    setSummary(data.summary || null);
    setPayerId(current => data.members?.some(m => String(m.id) === String(current)) ? current : String(data.members?.[0]?.id || ""));
    return data;
  }

  async function refresh(preferredId = activeId) {
    setLoading(true); setError("");
    try {
      const list = await request("/api/groups");
      setGroups(list);
      const chosen = list.find(g => String(g.id) === String(preferredId)) || list[0];
      if (chosen) {
        setActiveId(String(chosen.id));
        await loadGroup(chosen.id);
      } else {
        setActiveId("");
        setGroup(null);
        setExpenses([]);
        setSummary(null);
      }
    } catch (e) {
      setError(e.message || "Failed to connect to the backend API.");
    } finally { setLoading(false); }
  }

  useEffect(() => { refresh(""); }, []);
  useEffect(() => {
    if (activeId && (!group || String(group.id) !== String(activeId))) {
      loadGroup(activeId).catch(e => setError(e.message));
    }
  }, [activeId]);

  async function createGroup(event) {
    event.preventDefault(); setError(""); setNotice("");
    try {
      const members = memberNames.split(",").map(s => s.trim()).filter(Boolean);
      const created = await request("/api/groups", {
        method: "POST", body: JSON.stringify({ name: groupName, members })
      });
      setGroupName(""); setShowGroupForm(false);

      const initialSummary = {
        group_id: created.id,
        group_name: created.name,
        balances: created.members.map(m => ({ member_id: m.id, name: m.name, paid: 0, share: 0, net: 0 })),
        settlements: [],
        total_expenses: 0
      };
      const initialGroup = {
        ...created,
        expenses: [],
        summary: initialSummary
      };

      setGroup(initialGroup);
      setExpenses([]);
      setSummary(initialSummary);
      setPayerId(String(created.members[0]?.id || ""));
      setActiveId(String(created.id));
      setGroups(prev => [created, ...prev.filter(g => String(g.id) !== String(created.id))]);
      setNotice("Group created. Add your first expense.");
    } catch (e) { setError(e.message); }
  }

  async function createExpense(event) {
    event.preventDefault(); setError(""); setNotice("");
    try {
      await request(`/api/groups/${activeId}/expenses`, {
        method: "POST",
        body: JSON.stringify({ description, amount: Number(amount), payer_id: Number(payerId) })
      });
      setDescription(""); setAmount(""); setShowExpenseForm(false);
      await loadGroup(activeId);
      request("/api/groups").then(setGroups).catch(() => {});
      setNotice("Expense saved and balances recalculated.");
    } catch (e) { setError(e.message); }
  }

  const currentBalance = useMemo(() => {
    const mine = summary?.balances?.find(b => b.name.toLowerCase() === "sr");
    return mine?.net ?? 0;
  }, [summary]);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Wallet size={23} /></div>
          <div><strong>splitwise<span>lite</span></strong><small>GROUP MONEY, SIMPLIFIED</small></div>
        </div>
        <div className="side-label">WORKSPACE</div>
        <button className="nav-item active"><Activity size={18} /> Overview</button>
        <div className="side-label group-label">YOUR GROUPS <button className="icon-button tiny" onClick={() => setShowGroupForm(true)} title="Create group"><Plus size={16}/></button></div>
        <div className="group-list">
          {groups.map(g => <button key={g.id} className={`group-link ${String(g.id) === activeId ? "selected" : ""}`} onClick={() => setActiveId(String(g.id))}><span className="group-avatar">{g.name.slice(0, 1).toUpperCase()}</span><span className="group-name">{g.name}</span><span className="group-count">{g.members.length}</span></button>)}
          {!groups.length && <p className="muted side-empty">Your groups will show up here.</p>}
        </div>
        <div className="sidebar-bottom"><div className="avatar">SR</div><div><strong>Team workspace</strong><small>Hackathon MVP</small></div><span className="online-dot"/></div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumb">Workspace <span>/</span> <strong>{group?.name || "Overview"}</strong></div>
          <div className="top-actions"><span className="live-pill"><i/> API connected when backend is running</span><button className="icon-button" onClick={() => refresh(activeId)} title="Refresh"><RefreshCw size={17}/></button></div>
        </header>

        <section className="page">
          <div className="welcome-row">
            <div><div className="eyebrow">YOUR MONEY, WITHOUT THE MESS</div><h1>{group ? group.name : "Expense overview"}<span className="title-dot">.</span></h1><p className="subheading">Every expense accounted for. Every split crystal clear.</p></div>
            <div className="welcome-actions"><button className="btn btn-secondary" onClick={() => setShowGroupForm(true)}><Users size={17}/> New group</button><button className="btn btn-primary" disabled={!group} onClick={() => setShowExpenseForm(true)}><Plus size={18}/> Add expense</button></div>
          </div>

          {error && <div className="alert error"><X size={17}/><span>{error}</span><button onClick={() => setError("")}><X size={15}/></button></div>}
          {notice && <div className="alert success"><Check size={17}/><span>{notice}</span><button onClick={() => setNotice("")}><X size={15}/></button></div>}

          {loading ? <div className="loading-card"><RefreshCw className="spin" size={24}/><p>Loading your expenses...</p></div> : !group ? (
            <div className="empty-state"><div className="empty-icon"><Users size={28}/></div><h2>Start your first group</h2><p>Create a group, add your friends, and let the app handle the math.</p><button className="btn btn-primary" onClick={() => setShowGroupForm(true)}><Plus size={18}/> Create a group</button><div className="demo-note">Tip: Try a group called “Goa Trip” with three members.</div></div>
          ) : <>
            <div className="stats-grid">
              <StatCard label="TOTAL GROUP SPEND" value={currency(summary?.total_expenses)} icon={<CircleDollarSign size={20}/>} tone="purple" foot={`${expenses.length} recorded expense${expenses.length === 1 ? "" : "s"}`}/>
              <StatCard label="GROUP MEMBERS" value={group.members.length} icon={<Users size={20}/>} tone="blue" foot="Sharing the expenses"/>
              <StatCard label="YOUR NET BALANCE" value={currency(currentBalance)} icon={currentBalance >= 0 ? <ArrowDownLeft size={20}/> : <ArrowUpRight size={20}/>} tone={currentBalance >= 0 ? "green" : "orange"} foot={currentBalance > 0 ? "You are owed money" : currentBalance < 0 ? "You owe the group" : "All settled up"} valueTone={currentBalance > 0 ? "positive" : currentBalance < 0 ? "negative" : ""}/>
            </div>

            <div className="content-grid">
              <section className="panel expenses-panel">
                <div className="panel-header"><div><h2><ReceiptText size={19}/> Recent expenses</h2><p>Your group's latest activity</p></div><span className="count-pill">{expenses.length} total</span></div>
                {expenses.length ? <div className="expense-list">{expenses.map(e => <div className="expense-row" key={e.id}><div className={`expense-icon icon-${e.id % 4}`}><ReceiptText size={19}/></div><div className="expense-details"><strong>{e.description}</strong><span>Paid by {e.payer_name}</span></div><div className="expense-amount"><strong>{currency(e.amount)}</strong><span>Shared equally</span></div></div>)}</div> : <div className="mini-empty"><div className="mini-empty-icon"><ReceiptText size={22}/></div><strong>No expenses yet</strong><span>Add the first one to see the split.</span></div>}
                <button className="text-action" onClick={() => setShowExpenseForm(true)}><Plus size={16}/> Add a new expense</button>
              </section>

              <section className="panel balances-panel">
                <div className="panel-header"><div><h2><Activity size={19}/> Member balances</h2><p>Paid minus each person's share</p></div></div>
                <div className="balance-list">{summary?.balances?.map(b => <div className="balance-row" key={b.member_id}><div className="member-avatar">{b.name.slice(0, 1).toUpperCase()}</div><div className="balance-person"><strong>{b.name}</strong><span>Paid {currency(b.paid)}</span></div><div className={`balance-value ${b.net > 0 ? "positive" : b.net < 0 ? "negative" : ""}`}><strong>{b.net > 0 ? "+" : b.net < 0 ? "−" : ""}{currency(Math.abs(b.net))}</strong><span>{b.net > 0 ? "Gets back" : b.net < 0 ? "Owes" : "Settled"}</span></div></div>)}</div>
                <div className="balance-legend"><span><i className="legend-green"/> Gets money back</span><span><i className="legend-red"/> Owes money</span></div>
              </section>
            </div>

            <section className="panel settlements-panel">
              <div className="panel-header"><div><h2><ArrowDownLeft size={19}/> Suggested settlements</h2><p>Fewer transfers, less awkward money chasing.</p></div><span className="smart-pill"><Activity size={13}/> SMART SPLIT</span></div>
              {summary?.settlements?.length ? <div className="settlement-list">{summary.settlements.map((s, i) => <div className="settlement-row" key={`${s.from_member_id}-${s.to_member_id}-${i}`}><div className="settle-person"><div className="member-avatar debtor">{s.from_name.slice(0, 1).toUpperCase()}</div><strong>{s.from_name}</strong></div><div className="settle-transfer"><span>{currency(s.amount)}</span><div className="transfer-line"><i/><ArrowUpRight size={16}/></div></div><div className="settle-person"><div className="member-avatar creditor">{s.to_name.slice(0, 1).toUpperCase()}</div><strong>{s.to_name}</strong></div><span className="settle-caption">pays</span></div>)}</div> : <div className="settled-state"><span><Check size={18}/></span><div><strong>Everyone is settled up</strong><p>No payments are needed right now.</p></div></div>}
            </section>
            <footer className="footer-note">Built for simpler shared spending <span>•</span> Amounts shown in INR <span>•</span> Settlements are suggestions, not payments.</footer>
          </>}
        </section>
      </main>

      {showGroupForm && <Modal title="Create a group" subtitle="Bring your shared expenses into one place." onClose={() => setShowGroupForm(false)}><form onSubmit={createGroup} className="form-stack"><label>Group name<input value={groupName} onChange={e => setGroupName(e.target.value)} placeholder="e.g. Goa Trip" required maxLength="100"/></label><label>Members <span className="label-hint">Separate names with commas</span><textarea value={memberNames} onChange={e => setMemberNames(e.target.value)} placeholder="SR, Alex, Sam" rows="3" required/></label><div className="form-tip"><Users size={16}/> Add at least two members. You can use first names for the demo.</div><button className="btn btn-primary full-btn" type="submit"><Plus size={17}/> Create group</button></form></Modal>}

      {showExpenseForm && group && <Modal title="Add an expense" subtitle={`Record a shared cost in ${group.name}.`} onClose={() => setShowExpenseForm(false)}><form onSubmit={createExpense} className="form-stack"><label>What was it for?<input value={description} onChange={e => setDescription(e.target.value)} placeholder="e.g. Dinner, cab, groceries" required maxLength="160"/></label><label>Total amount (₹)<div className="amount-input"><span>₹</span><input type="number" min="0.01" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" required/></div></label><label>Who paid?<div className="select-wrap"><select value={payerId} onChange={e => setPayerId(e.target.value)} required>{group.members.map(m => <option value={m.id} key={m.id}>{m.name}</option>)}</select><ChevronDown size={16}/></div></label><div className="split-preview"><div><Users size={17}/><span>Split equally among {group.members.length} members</span></div><strong>{currency(Number(amount || 0) / group.members.length)} <small>/ person</small></strong></div><button className="btn btn-primary full-btn" type="submit"><Check size={17}/> Save expense</button></form></Modal>}
    </div>
  );
}

function StatCard({ label, value, icon, tone, foot, valueTone = "" }) {
  return <div className="stat-card"><div className="stat-top"><span>{label}</span><div className={`stat-icon ${tone}`}>{icon}</div></div><div className={`stat-value ${valueTone}`}>{value}</div><div className="stat-foot"><span className="stat-foot-dot"/> {foot}</div></div>;
}

function Modal({ title, subtitle, onClose, children }) {
  useEffect(() => {
    const close = e => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><section className="modal"><div className="modal-header"><div><h2>{title}</h2><p>{subtitle}</p></div><button className="icon-button" onClick={onClose}><X size={18}/></button></div>{children}</section></div>;
}

createRoot(document.getElementById("root")).render(<App />);
