import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  db, auth, collection, doc, getDoc, getDocs, updateDoc, deleteDoc, 
  query, orderBy, limit, onAuthStateChanged 
} from './firebase_config'; 
import { checkPermission, loadUserData } from './firebase_config'; 
import './FinanceInput.css';

const ProjectCard = ({ data, agents, onProcess, onDelete, canEdit }) => {
  // Parse Dates
  const dateStr = data.completedAt ? new Date(data.completedAt.seconds * 1000).toLocaleDateString() : 'Unknown';
  
  // Calculate scanned hours
  const scannedSecs = (data.originalSeconds || 0) - (data.finalSeconds || 0);
  const scannedHrs = (scannedSecs / 3600).toFixed(2);

  // Form States
  const [desc, setDesc] = useState(data.financeDesc || `${data.project} - ${data.size}`);
  const [totalUnits, setTotalUnits] = useState(data.totalUnits || '');
  const [invoiceAmount, setInvoiceAmount] = useState(data.invoiceAmount || '');
  const [selectedAgent, setSelectedAgent] = useState(data.agentName || '');
  const [commExcluded, setCommExcluded] = useState(data.commissionExcluded || '');
  
  // Adjustment States
  const [isAdjusting, setIsAdjusting] = useState(data.laborAdjustmentActive === true);
  const [op, setOp] = useState(data.laborAdjustmentType || 'add');
  const [method, setMethod] = useState(data.laborCalculationMethod || 'total');
  
  // Adjustment Values
  const [manualTotal, setManualTotal] = useState(data.manualTotalHours || '');
  const [manualPpl, setManualPpl] = useState(data.manualPeople || '');
  const [manualAvg, setManualAvg] = useState(data.manualAvgHours || '');

  // BONUS ELIGIBILITY STATE (Default to true unless explicitly false in DB)
  const [isBonusEligible, setIsBonusEligible] = useState(data.bonusEligible !== false);
  const [bonusReason, setBonusReason] = useState(data.bonusIneligibleReason || '');

  const handleProcess = () => {
    onProcess(data.id, {
      desc, totalUnits, invoiceAmount, selectedAgent, commExcluded,
      isAdjusting, op, method, manualTotal, manualPpl, manualAvg,
      // Pass Bonus Data
      isBonusEligible, bonusReason,
      originalSeconds: data.originalSeconds,
      finalSeconds: data.finalSeconds
    });
  };

  return (
    <div className="task-card">
      <div className="task-header">
        <div>
          <div className="project-title">{data.project}</div>
          <div className="project-meta">{data.company} • {data.size}</div>
        </div>
        <div className="time-badge">{dateStr}</div>
      </div>

      <div className="input-grid">
        <div><label>Packing List # (Locked)</label><input type="text" value={data.plNumber || '-'} disabled /></div>
        <div><label>Project Type (Locked)</label><input type="text" value={data.projectType || '-'} disabled /></div>
        <div>
          <label>Description (Editable)</label>
          <input type="text" value={desc} onChange={(e) => setDesc(e.target.value)} disabled={!canEdit} />
        </div>

        <div>
          <label>Total Units Produced</label>
          <input type="number" value={totalUnits} onChange={(e) => setTotalUnits(e.target.value)} disabled={!canEdit} />
        </div>
        <div>
          <label>Total Invoice Value ($)</label>
          <input type="number" value={invoiceAmount} onChange={(e) => setInvoiceAmount(e.target.value)} disabled={!canEdit} />
        </div>
        <div>
          <label>Commission Agent</label>
          <select value={selectedAgent} onChange={(e) => setSelectedAgent(e.target.value)} disabled={!canEdit}>
            <option value="">None</option>
            {agents.map((a, idx) => (
              <option key={idx} value={a.name}>{a.name} ({a.comm}%)</option>
            ))}
          </select>
        </div>

        {selectedAgent && (
          <div>
            <label style={{ color: '#e67e22' }}>Exclude from Comm ($)</label>
            <input 
              type="number" 
              value={commExcluded} 
              onChange={(e) => setCommExcluded(e.target.value)} 
              placeholder="e.g. Shipping/Tax" 
              disabled={!canEdit}
            />
          </div>
        )}
      </div>

      {/* BONUS ELIGIBILITY SECTION - MATCHING HTML LOGIC */}
      <div className="bonus-box">
        <label className="chk-container">
            <input 
                type="checkbox" 
                checked={isBonusEligible} 
                onChange={(e) => setIsBonusEligible(e.target.checked)} 
                disabled={!canEdit}
            />
            <span className="chk-label" style={{color:'#2c3e50'}}>Project Eligible for Bonus?</span>
        </label>
        
        {/* Only show reason box if UNCHECKED */}
        {!isBonusEligible && (
            <div className="reason-box">
                <label style={{color:'#c0392b'}}>Reason for Ineligibility *</label>
                <input 
                    type="text" 
                    className="std-input" 
                    value={bonusReason}
                    onChange={(e) => setBonusReason(e.target.value)}
                    placeholder="e.g. Rework Required, Late Shipment, Quality Issue" 
                    disabled={!canEdit}
                />
            </div>
        )}
      </div>

      <div className="adjustment-box">
        <div className="adjustment-header">
          <label className="chk-container">
            <input 
              type="checkbox" 
              checked={isAdjusting} 
              onChange={(e) => setIsAdjusting(e.target.checked)} 
              disabled={!canEdit} 
            />
            <span className="chk-label" style={{ color: '#e67e22' }}>Confirm Time Adjustment</span>
          </label>
          <span style={{ fontSize: '11px', color: '#7f8c8d', alignSelf: 'center' }}>
            Scanned Time: <strong>{scannedHrs} hrs</strong>
          </span>
        </div>

        {isAdjusting ? (
          <div>
            <div className="adjustment-row">
              <div style={{ flex: 1 }}>
                <label>Operation</label>
                <select value={op} onChange={(e) => setOp(e.target.value)} disabled={!canEdit}>
                  <option value="add">Add (+)</option>
                  <option value="sub">Subtract (-)</option>
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label>Method</label>
                <select value={method} onChange={(e) => setMethod(e.target.value)} disabled={!canEdit}>
                  <option value="total">Total Man Hours</option>
                  <option value="calc">Hours x Men</option>
                </select>
              </div>
            </div>

            {method === 'total' ? (
              <div>
                <label>Total Hours to Adjust</label>
                <input 
                  type="number" 
                  value={manualTotal} 
                  onChange={(e) => setManualTotal(e.target.value)} 
                  placeholder="e.g. 2.5" 
                  disabled={!canEdit}
                />
              </div>
            ) : (
              <div className="adjustment-calc-grid">
                <div>
                  <label># People</label>
                  <input 
                    type="number" 
                    value={manualPpl} 
                    onChange={(e) => setManualPpl(e.target.value)} 
                    placeholder="e.g. 5" 
                    disabled={!canEdit}
                  />
                </div>
                <div>
                  <label>Hours Each</label>
                  <input 
                    type="number" 
                    value={manualAvg} 
                    onChange={(e) => setManualAvg(e.target.value)} 
                    placeholder="e.g. 8" 
                    disabled={!canEdit}
                  />
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="info-none">
            Using Scan Data Only. No adjustments will be made.
          </div>
        )}
      </div>

      <div className="btn-container">
        {canEdit ? (
          <>
            <button className="btn btn-red" onClick={() => onDelete(data.id)}>Delete</button>
            <button className="btn btn-green" onClick={handleProcess}>Finalize & Complete</button>
          </>
        ) : (
          <div style={{ color: '#999', fontStyle: 'italic' }}>Read Only View</div>
        )}
      </div>
    </div>
  );
};

const FinanceInput = () => {
  const navigate = useNavigate();
  
  const [loading, setLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [agents, setAgents] = useState([]);
  const [pendingProjects, setPendingProjects] = useState([]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        loadUserData(user, () => {
          if (checkPermission('finance', 'view')) {
            setCanEdit(checkPermission('finance', 'edit'));
            initData();
          } else {
            setAccessDenied(true);
            setLoading(false);
          }
        });
      } else {
        window.location.href = 'index.html';
      }
    });
    return () => unsubscribe();
  }, []);

  const initData = async () => {
    try {
      const configSnap = await getDoc(doc(db, "config", "finance"));
      if (configSnap.exists()) setAgents(configSnap.data().agents || []);

      const q = query(collection(db, "reports"), orderBy("completedAt", "desc"), limit(100));
      const snap = await getDocs(q);
      let pending = [];
      snap.forEach(doc => {
        const d = doc.data();
        if (d.financeStatus === "pending_finance") pending.push({ id: doc.id, ...d });
      });
      setPendingProjects(pending);
    } catch (e) {
      console.error("Error loading data:", e);
      alert("Error loading data: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleProcessItem = async (id, formState) => {
    if (!canEdit) return alert("Access Denied");
    
    // Validation
    if (!formState.totalUnits || !formState.invoiceAmount) {
      return alert("Please enter Total Units and Invoice Amount.");
    }

    // BONUS VALIDATION: If NOT eligible, reason is required
    if (!formState.isBonusEligible && !formState.bonusReason.trim()) {
        return alert("Please enter a reason why this project is ineligible for a bonus.");
    }

    let updates = {
      financeDesc: formState.desc,
      totalUnits: Number(formState.totalUnits),
      invoiceAmount: Number(formState.invoiceAmount),
      agentName: formState.selectedAgent,
      commissionExcluded: Number(formState.commExcluded) || 0,
      financeStatus: "complete",
      laborAdjustmentActive: formState.isAdjusting,
      
      // SAVE BONUS DATA
      bonusEligible: formState.isBonusEligible,
      bonusIneligibleReason: formState.isBonusEligible ? "" : formState.bonusReason
    };

    // Calculate Hours
    let finalSecondsResult = (formState.originalSeconds || 0) - (formState.finalSeconds || 0);

    if (formState.isAdjusting) {
      updates.laborAdjustmentType = formState.op;
      updates.laborCalculationMethod = formState.method;

      let adjustHours = 0;

      if (formState.method === 'total') {
        adjustHours = parseFloat(formState.manualTotal);
        if (!adjustHours || adjustHours < 0) return alert("Please enter valid Total Hours.");
        updates.manualTotalHours = adjustHours;
      } else {
        const ppl = parseFloat(formState.manualPpl);
        const avg = parseFloat(formState.manualAvg);
        if (!ppl || !avg) return alert("Please enter People and Hours.");
        adjustHours = ppl * avg;
        updates.manualPeople = ppl;
        updates.manualAvgHours = avg;
        updates.manualTotalHours = adjustHours;
      }

      const adjustSeconds = adjustHours * 3600;

      if (formState.op === 'add') {
        finalSecondsResult += adjustSeconds;
      } else {
        finalSecondsResult -= adjustSeconds;
        if (finalSecondsResult < 0) finalSecondsResult = 0;
      }
    } else {
        updates.manualTotalHours = 0;
    }

    updates.originalSeconds = finalSecondsResult;
    updates.finalSeconds = 0;

    if (window.confirm("Finalize this report? It will move to the Financial Report.")) {
      try {
        await updateDoc(doc(db, "reports", id), updates);
        initData();
      } catch (e) {
        console.error(e);
        alert("Error updating document.");
      }
    }
  };

  const handleDeleteItem = async (id) => {
    if (!canEdit) return alert("Access Denied");
    if (window.confirm("Are you sure you want to PERMANENTLY DELETE this report?")) {
      try {
        await deleteDoc(doc(db, "reports", id));
        initData();
      } catch (e) {
        console.error(e);
        alert("Error deleting document.");
      }
    }
  };

  if (loading) return <div className="container"><p style={{ textAlign: 'center', marginTop: '50px' }}>Loading pending projects...</p></div>;
  if (accessDenied) return <div className="container"><div className="denied-box">⛔ ACCESS DENIED<br />You do not have permission to view this page.</div></div>;

  return (
    <>
      <div className="top-bar">
        <div 
          onClick={() => navigate('/')} 
          style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px', color: '#2c3e50', fontWeight: 'bold' }}
        >
          <span className="material-icons">arrow_back</span> Dashboard
        </div>
        <div className="top-bar-title">
          <span className="material-icons">monetization_on</span> Finance Input
        </div>
      </div>

      <div className="finance-container">
        {pendingProjects.length === 0 ? (
          <div className="empty-state">
            <span className="material-icons" style={{ fontSize: '48px' }}>paid</span><br />
            <h3>No projects waiting.</h3>
            <p style={{ color: '#7f8c8d' }}>Production must submit items first.</p>
          </div>
        ) : (
          pendingProjects.map(project => (
            <ProjectCard 
              key={project.id} 
              data={project} 
              agents={agents}
              canEdit={canEdit}
              onProcess={handleProcessItem}
              onDelete={handleDeleteItem}
            />
          ))
        )}
      </div>
    </>
  );
};

export default FinanceInput;