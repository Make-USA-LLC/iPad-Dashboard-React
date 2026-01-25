// src/calculations/bonuses.js

export const sanitize = (str) => (str || '').toLowerCase().replace(/[^a-z0-9]/g, '');

export const getPayDate = (report) => {
    if (report.payDate) return report.payDate;
    if (report.bonusPaidAt) {
        const pd = new Date(report.bonusPaidAt.seconds * 1000);
        return pd.toLocaleDateString();
    }
    const timestamp = report.completedAt;
    if (!timestamp) return 'N/A';
    const d = new Date(timestamp.seconds * 1000);
    const day = d.getDay(); 
    const distToSat = 6 - day;
    const nextTue = new Date(d);
    nextTue.setDate(d.getDate() + distToSat + 3);
    return nextTue.toLocaleDateString();
};

export const getWorkWeekFromPayDate = (payDateStr) => {
    const parts = payDateStr.split('/');
    if(parts.length !== 3) return { start: 0, label: "Unknown" };
    
    const payDate = new Date(parseInt(parts[2]), parseInt(parts[0])-1, parseInt(parts[1]));
    const payDay = payDate.getDay(); 
    const startOfPayWeek = new Date(payDate);
    startOfPayWeek.setDate(payDate.getDate() - payDay);
    
    const startOfWorkWeek = new Date(startOfPayWeek);
    startOfWorkWeek.setDate(startOfPayWeek.getDate() - 7);
    startOfWorkWeek.setHours(0,0,0,0);

    const endOfWorkWeek = new Date(startOfWorkWeek);
    endOfWorkWeek.setDate(startOfWorkWeek.getDate() + 6);
    
    return {
        start: startOfWorkWeek.getTime(),
        label: `Work Week: ${startOfWorkWeek.toLocaleDateString()} - ${endOfWorkWeek.toLocaleDateString()}`,
        simpleLabel: `${startOfWorkWeek.toLocaleDateString()} - ${endOfWorkWeek.toLocaleDateString()}`
    };
};

// THE MAIN CALCULATOR
export const calculateBonuses = (reports, globalConfig, workersDirectory = [], filterUser = null) => {
    const empMap = {}; 

    reports.forEach(r => {
        // 1. CONFIG PRIORITY (Historical vs Global)
        const usedConfig = r.historicalConfig || globalConfig;
        const COST_PER_HR = parseFloat(usedConfig.costPerHour) || 0;

        const isPaid = r.bonusPaid === true;
        const isIneligible = (r.bonusEligible === false && !isPaid);

        // 2. PROFIT CALC
        const seconds = (r.originalSeconds || 0) - (r.finalSeconds || 0);
        const hours = seconds > 0 ? (seconds / 3600) : 0;
        const laborCost = hours * COST_PER_HR;

        let comm = 0;
        if(r.agentName && usedConfig.agents) {
            const ag = usedConfig.agents.find(a => a.name === r.agentName);
            if(ag) {
                const excluded = r.commissionExcluded || 0;
                const basis = Math.max(0, (r.invoiceAmount||0) - excluded);
                comm = basis * (parseFloat(ag.comm)/100);
            }
        }

        const profit = (r.invoiceAmount||0) - laborCost - comm;

        // 3. WORKER IDENTIFICATION
        const safeLeader = sanitize(r.leader);
        const workers = [];
        const log = r.workerLog || [];
        let leaderMin = 0;
        let maxWorkerMin = 0;

        log.forEach(w => {
            if (w.minutes > maxWorkerMin) maxWorkerMin = w.minutes;
            if (sanitize(w.name) === safeLeader && safeLeader.length > 0) {
                leaderMin = w.minutes;
            } else {
                workers.push(w);
            }
        });
        if(r.leader && leaderMin === 0 && hours > 0) leaderMin = hours * 60;

        // 4. POOL CALCULATION
        let leaderPool = 0;
        let workerPool = 0;
        let method = r.bonusCalcMethod?.type || 'standard_percent';
        let params = r.bonusCalcMethod || {};

        if (method === 'standard_percent') {
            leaderPool = Math.max(0, profit * ((usedConfig.leaderPoolPercent || 0) / 100));
            workerPool = Math.max(0, profit * ((usedConfig.workerPoolPercent || 0) / 100));
        } 
        else if (method === 'leader_percent') {
            leaderPool = Math.max(0, profit * ((params.l_pct || 0) / 100));
            workerPool = 0;
        }
        else if (method === 'custom_percent') {
            leaderPool = Math.max(0, profit * ((params.l_pct || 0) / 100));
            workerPool = Math.max(0, profit * ((params.w_pct || 0) / 100));
        }
        else if (method === 'fixed_amount') {
            leaderPool = parseFloat(params.l_fix) || 0;
            workerPool = parseFloat(params.w_fix) || 0;
        }
        else if (method === 'legacy_interval') {
            const lAmt = parseFloat(params.l_amt)||0; const lThr = parseFloat(params.l_thr)||1000;
            const wAmt = parseFloat(params.w_amt)||0; const wThr = parseFloat(params.w_thr)||1000;
            leaderPool = (lThr>0 && profit>0) ? Math.floor(profit/lThr)*lAmt : 0;
            workerPool = (wThr>0 && profit>0) ? Math.floor(profit/wThr)*wAmt*workers.length : 0;
        }

        // 30-Minute Rule (Skip if Leader Only Mode)
        if (method !== 'leader_percent' && leaderMin > 0 && maxWorkerMin > 0) {
            const diff = maxWorkerMin - leaderMin;
            if (diff > 30) {
                const ratio = leaderMin / maxWorkerMin;
                const amountToMove = leaderPool * (1 - ratio);
                leaderPool -= amountToMove;
                workerPool += amountToMove;
            }
        }

        const totalWMin = workers.reduce((sum, w) => sum + (w.minutes||0), 0);
        const distType = params.distribution || 'hours';

        // 5. DISTRIBUTION HELPER
        const distribute = (name, role, hrs, rawAmt) => {
            // Apply User Filter if exists
            if (filterUser && sanitize(name) !== sanitize(filterUser)) return;

            let displayName = name;
            // Resolve nice name from directory if available
            const match = workersDirectory.find(w => sanitize(w.fullName) === sanitize(name) || sanitize(w.lastName + w.firstName) === sanitize(name));
            if (match) displayName = match.fullName;

            let amt = rawAmt;
            let isCustom = false;
            
            // Check overrides
            if (r.customBonuses) {
                const cKey = Object.keys(r.customBonuses).find(k => sanitize(k) === sanitize(name));
                if (cKey) {
                    amt = parseFloat(r.customBonuses[cKey]);
                    isCustom = true;
                }
            }
            
            if (isIneligible && !isCustom) amt = 0;
            // Filter out 0 amounts unless it was manually set to 0 or is ineligible tracking
            if (amt <= 0 && !isCustom && !isIneligible) return;

            if(!empMap[displayName]) empMap[displayName] = { name: displayName, total: 0, items: [] };
            
            empMap[displayName].items.push({
                id: r.id, 
                project: r.project,
                company: r.company,
                payDate: getPayDate(r),
                rawDate: r.completedAt ? r.completedAt.seconds : 0,
                originalDate: r.completedAt ? new Date(r.completedAt.seconds*1000).toLocaleDateString() : 'N/A',
                role: role,
                hours: hrs,
                amount: amt,
                isCustom: isCustom,
                isIneligible: isIneligible,
                reason: isIneligible ? (r.bonusIneligibleReason || "") : "",
                invoice: r.invoiceAmount || 0,
                profit: profit,
                plNumber: r.plNumber || '',
                agent: r.agentName || ''
            });
            empMap[displayName].total += amt;
        };

        // Distribute to Leader
        if(r.leader) distribute(r.leader, 'Leader', leaderMin/60, leaderPool);
        
        // Distribute to Workers
        workers.forEach(w => {
            if(method === 'leader_percent') return; // Skip if leader only

            let share = 0;
            if (workerPool > 0) {
                if (distType === 'even') share = workerPool / workers.length;
                else share = totalWMin > 0 ? workerPool * (w.minutes / totalWMin) : 0;
            }
            distribute(w.name, 'Worker', w.minutes/60, share);
        });
    });

    const results = Object.values(empMap);
    results.sort((a,b) => a.name.localeCompare(b.name));
    return results;
};