import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import './ProjectSearch.css';
import { db, auth, loadUserData } from './firebase_config.jsx';
import { collection, query, limit, where, getDocs, doc, getDoc } from 'firebase/firestore';
import { onAuthStateChanged, signOut } from 'firebase/auth';

const FIELD_MAPPINGS = {
    'Line Leader': ['line leader', 'line leader_1', 'leader', 'lineleader'],
    'Desc': ['desc', 'financedesc', 'description', 'project', 'project name', 'item'],
    'CUSTOMER': ['customer', 'company', 'client', 'customer name'],
    'PL#': ['pl#', 'pl', 'job id', 'job #', 'pl number'],
    'Inv $': ['inv $', 'invoice amount', 'invoice total', 'total'],
    'Profit/ loss': ['profit/ loss', 'p/l', 'profit', 'loss', 'net profit'],
    'Labor HRS': ['labor hrs', 'hours', 'total hours'],
    'Cost': ['cost', 'labor cost'],
    'Units': ['units', 'total units', 'qty', 'quantity'],
    'Unit/Sec': ['unit/sec', 'units per sec'],
    'Sec/Unit': ['sec/unit', 'efficiency', 'seconds per unit'],
    'Commission': ['commission', 'comm'],
    'Agent': ['agent', 'sales rep','agentname'],
    'Type': ['type', 'category', 'project type'],
    'Bonus': ['bonus', 'bonus amount'],
    'Recommended price/unit': ['recommended price/unit', 'price/unit', 'unit price', 'recommendedprice']
};

const DEFAULT_COLUMNS = [
    'Line Leader', 'Date', 'CUSTOMER', 'PL#', 'Desc', 
    'Labor HRS', 'Cost', 'Inv $', 'Units', 
    'Unit/Sec', 'Commission', 'Agent', 
    'Profit/ loss', 'Sec/Unit', 'Type', 
    'Recommended price/unit'
];

const ProjectSearch = () => {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [hasAccess, setHasAccess] = useState(false);
    
    // Data
    const [combinedData, setCombinedData] = useState([]);
    const [filteredData, setFilteredData] = useState([]);
    const [categories, setCategories] = useState([]);
    const [allColumns, setAllColumns] = useState([]);
    const [visibleColumns, setVisibleColumns] = useState(new Set([...DEFAULT_COLUMNS, 'Source']));

    // Filters
    const [searchText, setSearchText] = useState('');
    const [selectedCategory, setSelectedCategory] = useState('');
    const [minUnits, setMinUnits] = useState('');
    const [maxUnits, setMaxUnits] = useState('');
    const [showColMenu, setShowColMenu] = useState(false);

    // Pagination
    const [currentPage, setCurrentPage] = useState(1);
    const rowsPerPage = 250;

    // Sorting
    const [sortCol, setSortCol] = useState('Date');
    const [sortAsc, setSortAsc] = useState(false); // Default DESC

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (user) => {
            if (user) {
                loadUserData(user, async () => {
                    await checkAccess(user);
                });
            } else {
                navigate('/');
            }
        });
        return () => unsubscribe();
    }, []);

    const checkAccess = async (user) => {
        const uSnap = await getDoc(doc(db, "users", user.email.toLowerCase()));
        if (!uSnap.exists()) return denyAccess();
        const role = uSnap.data().role;

        const rolesSnap = await getDoc(doc(db, "config", "roles"));
        let allowed = false;
        if (role === 'admin') allowed = true;
        else if (rolesSnap.exists()) {
            const rc = rolesSnap.data()[role];
            if (rc && (rc['search_view'] || rc['admin_view'])) allowed = true;
        }

        if (allowed) {
            setHasAccess(true);
            await initData();
        } else {
            denyAccess();
        }
    };

    const denyAccess = () => {
        setLoading(false);
    };

    const initData = async () => {
        setLoading(true);
        try {
            // 1. Get Categories
            const cSnap = await getDoc(doc(db, "config", "finance"));
            if(cSnap.exists()) setCategories((cSnap.data().projectTypes || []).sort());

            // 2. Fetch Data
            const [archiveResult, reportsResult] = await Promise.allSettled([
                getDocs(query(collection(db, "archive"), limit(1000))),
                getDocs(query(collection(db, "reports"), where("financeStatus", "==", "complete"), limit(1000)))
            ]);

            // 3. Process Archive
            const archiveList = (archiveResult.status === 'fulfilled') 
                ? archiveResult.value.docs.map(d => {
                    let flat = flattenObject(d.data());
                    if(flat['Date']) flat['Date'] = excelDateToJSDate(flat['Date']);
                    flat = normalizeRecord(flat);
                    return { _source: 'archive', id: d.id, ...flat };
                }) : [];

            // 4. Process Live
            const reportsList = (reportsResult.status === 'fulfilled')
                ? reportsResult.value.docs.map(d => {
                    const data = d.data();
                    const orig = data.originalSeconds || 0;
                    const final = data.finalSeconds || 0;
                    const secondsWorked = orig - final;
                    const units = data.totalUnits || 0;
                    const laborHrs = (secondsWorked / 3600);
                    const secPerUnit = (units > 0 && secondsWorked > 0) ? (secondsWorked / units) : 0;
                    const unitPerSec = (secondsWorked > 0) ? (units / secondsWorked) : 0;

                    const enriched = {
                        ...data,
                        'Date': data.completedAt ? new Date(data.completedAt.seconds*1000).toLocaleDateString() : '-',
                        'Labor HRS': laborHrs,
                        'Sec/Unit': secPerUnit,
                        'Unit/Sec': unitPerSec, 
                        'Inv $': data.invoiceAmount || 0,
                        'CUSTOMER': data.company,
                        'Desc': data.project,
                        'Line Leader': data.leader, 
                        'PL#': data.jobId,
                        'Type': data.jobName || data.category || ''
                    };
                    
                    let flat = flattenObject(enriched);
                    flat = normalizeRecord(flat);
                    return { _source: 'live', id: d.id, ...flat };
                }) : [];

            // 5. Merge & Setup
            let combined = [...reportsList, ...archiveList];
            
            // Extract Columns
            const keys = new Set(['Source']);
            DEFAULT_COLUMNS.forEach(c => keys.add(c));
            combined.slice(0, 100).forEach(row => {
                Object.keys(row).forEach(k => {
                    const kLow = k.toLowerCase();
                    const restricted = ['inv', 'cost', 'profit', 'bonus', 'commission', 'price', '$'];
                    if(!k.startsWith('_') && !restricted.some(r => kLow.includes(r))) {
                        keys.add(k);
                    }
                });
            });
            setAllColumns(Array.from(keys));
            
            setCombinedData(combined);
            setFilteredData(combined); // Initial state
            
            // Initial Sort
            handleSort('Date', combined, false);

        } catch(e) { console.error(e); }
        setLoading(false);
    };

    // --- HELPERS ---
    const flattenObject = (ob, prefix = '', result = null) => {
        result = result || {};
        for (const i in ob) {
            if (!Object.prototype.hasOwnProperty.call(ob, i)) continue;
            if ((typeof ob[i]) === 'object' && ob[i] !== null && !Array.isArray(ob[i]) && !(ob[i] instanceof Date)) {
                flattenObject(ob[i], prefix + i + '.', result);
            } else {
                result[prefix + i] = ob[i];
            }
        }
        return result;
    };

    const normalizeRecord = (flatData) => {
        for (const [targetKey, variations] of Object.entries(FIELD_MAPPINGS)) {
            Object.keys(flatData).forEach(dataKey => {
                const lowerDataKey = dataKey.toLowerCase().trim();
                if (variations.includes(lowerDataKey)) {
                    if (!flatData[targetKey] && flatData[dataKey] !== undefined && flatData[dataKey] !== '') {
                        flatData[targetKey] = flatData[dataKey];
                    }
                    if (dataKey !== targetKey) delete flatData[dataKey];
                }
            });
        }
        return flatData;
    };

    const excelDateToJSDate = (serial) => {
        if (!serial) return '-';
        if (typeof serial === 'string') return serial;
        const date = new Date(Math.round((serial - 25569) * 86400 * 1000));
        return isNaN(date) ? '-' : date.toLocaleDateString();
    };

    const formatValue = (key, val) => {
        if (val === undefined || val === null) return '';
        if (typeof val === 'number') {
            const k = key.toLowerCase();
            if (k.includes('price') || k.includes('cost') || k.includes('$') || k.includes('inv') || k.includes('profit') || k.includes('hrs') || k.includes('sec/unit') || k.includes('commission')||k.includes('unit/sec') || k.includes('bonus')) {
                return val.toFixed(2);
            }
        }
        return val;
    };

    // --- ACTIONS ---
    const handleSearch = () => {
        const txt = searchText.toLowerCase();
        const minU = parseFloat(minUnits) || 0;
        const maxU = parseFloat(maxUnits) || 999999999;

        const result = combinedData.filter(row => {
            const rowStr = JSON.stringify(Object.values(row)).toLowerCase();
            const matchText = !txt || rowStr.includes(txt);
            const matchCat = !selectedCategory || (row['Type'] === selectedCategory);
            
            let u = 0;
            const unitVal = row['Units'] || row['totalUnits'] || 0;
            u = parseFloat(String(unitVal).replace(/,/g, '')) || 0;
            const matchUnits = (u >= minU && u <= maxU);
            
            return matchText && matchCat && matchUnits;
        });

        setFilteredData(result);
        setCurrentPage(1);
        handleSort(sortCol, result, sortAsc); // Re-apply sort
    };

    const handleClear = () => {
        setSearchText('');
        setSelectedCategory('');
        setMinUnits('');
        setMaxUnits('');
        setFilteredData(combinedData);
        setCurrentPage(1);
    };

    const handleSort = (col, data = filteredData, ascending = true) => {
        const sorted = [...data].sort((a, b) => {
            let valA = a[col];
            let valB = b[col];
            
            const getVal = (v) => (v === undefined || v === null || v === '-') ? '' : v;
            valA = getVal(valA);
            valB = getVal(valB);

            let isNum = typeof valA === 'number' && typeof valB === 'number';
            
            if (col.includes('Date')) {
                const dA = new Date(valA);
                const dB = new Date(valB);
                if (!isNaN(dA) && !isNaN(dB)) {
                    valA = dA; valB = dB; isNum = true; 
                }
            }

            if (isNum) return ascending ? (valA - valB) : (valB - valA);
            
            valA = String(valA).toLowerCase();
            valB = String(valB).toLowerCase();
            if (valA < valB) return ascending ? -1 : 1;
            if (valA > valB) return ascending ? 1 : -1;
            return 0;
        });

        setFilteredData(sorted);
        setSortCol(col);
        setSortAsc(ascending);
    };

    const toggleColumn = (col) => {
        const newSet = new Set(visibleColumns);
        if (newSet.has(col)) newSet.delete(col);
        else newSet.add(col);
        setVisibleColumns(newSet);
    };

    const handleExport = () => {
        if (filteredData.length === 0) return alert("No data");
        const exportData = filteredData.map(row => {
            const clean = {};
            allColumns.forEach(col => {
                if (visibleColumns.has(col) && col !== 'Source') {
                    clean[col] = row[col];
                }
            });
            return clean;
        });
        const ws = XLSX.utils.json_to_sheet(exportData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Projects");
        XLSX.writeFile(wb, "MakeUSA_Search_Export.xlsx");
    };

    // --- RENDER ---
    const totalPages = Math.ceil(filteredData.length / rowsPerPage);
    const startIdx = (currentPage - 1) * rowsPerPage;
    const currentData = filteredData.slice(startIdx, startIdx + rowsPerPage);

    if (!hasAccess && !loading) return <div className="ps-denied">⛔ ACCESS DENIED</div>;
    if (loading) return <div style={{padding:'50px', textAlign:'center'}}>Loading Archive...</div>;

    return (
        <div className="ps-wrapper">
            <div className="ps-top-bar">
                <div style={{display:'flex', alignItems:'center', gap:'20px'}}>
                    <button onClick={() => navigate('/')} className="btn-link">&larr; Dashboard</button>
                    <h3 style={{margin:0}}>Global Project Search</h3>
                </div>
                <div style={{display:'flex', alignItems:'center'}}>
                    <button onClick={() => navigate('/upload')} className="btn-upload">Upload Excel</button>
                    <button onClick={() => signOut(auth).then(() => navigate('/'))} className="btn-link" style={{color:'#e74c3c'}}>Sign Out</button>
                </div>
            </div>

            <div className="ps-container">
                <div className="ps-filter-card">
                    <div className="ps-input-group" style={{flex:2}}>
                        <label className="ps-label">Search</label>
                        <input className="ps-input" value={searchText} onChange={e => setSearchText(e.target.value)} onKeyDown={e => e.key==='Enter' && handleSearch()} placeholder="Keyword..." />
                    </div>
                    <div className="ps-input-group">
                        <label className="ps-label">Type</label>
                        <select className="ps-select" value={selectedCategory} onChange={e => { setSelectedCategory(e.target.value); handleSearch(); }}>
                            <option value="">All Types</option>
                            {categories.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                    </div>
                    <div className="ps-input-group">
                        <label className="ps-label">Units</label>
                        <div className="ps-range-group">
                            <input className="ps-input" type="number" placeholder="Min" value={minUnits} onChange={e => setMinUnits(e.target.value)} />
                            <input className="ps-input" type="number" placeholder="Max" value={maxUnits} onChange={e => setMaxUnits(e.target.value)} />
                        </div>
                    </div>
                    
                    <button className="btn btn-search" onClick={handleSearch}>Search</button>
                    <button className="btn btn-clear" onClick={handleClear}>Clear</button>
                    
                    <div style={{width:'1px', background:'#eee', height:'40px', margin:'0 10px'}}></div>
                    
                    <button className="btn btn-export" onClick={handleExport}>Export</button>
                    
                    <div style={{position:'relative'}}>
                        <button className="btn btn-cols" onClick={() => setShowColMenu(!showColMenu)}>Columns</button>
                        {showColMenu && (
                            <div className="ps-col-dropdown">
                                {allColumns.map(col => (
                                    <div key={col} className="ps-col-option" onClick={() => toggleColumn(col)}>
                                        <input type="checkbox" checked={visibleColumns.has(col)} readOnly />
                                        <span>{col}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                <div className="ps-results-card">
                    <div style={{padding:'10px 15px', borderBottom:'1px solid #eee', color:'#7f8c8d', fontSize:'11px', display:'flex', justifyContent:'space-between'}}>
                        <span>{filteredData.length} Records Found</span>
                        <div style={{display:'flex', gap:'10px'}}>
                            <span style={{display:'flex', alignItems:'center', gap:'5px'}}><div style={{width:'8px', height:'8px', background:'#e8f6f3', borderRadius:'50%'}}></div> Live App</span>
                            <span style={{display:'flex', alignItems:'center', gap:'5px'}}><div style={{width:'8px', height:'8px', background:'#fff8e1', borderRadius:'50%'}}></div> Archive</span>
                        </div>
                    </div>

                    <div style={{overflowX:'auto'}}>
                        <table className="ps-table">
                            <thead>
                                <tr>
                                    {allColumns.map(col => (
                                        visibleColumns.has(col) && (
                                            <th key={col} onClick={() => handleSort(col, undefined, !sortAsc)}>
                                                {col} {sortCol === col ? (sortAsc ? '↑' : '↓') : ''}
                                            </th>
                                        )
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {currentData.length === 0 ? (
                                    <tr><td colSpan="100%" className="ps-empty">No records found.</td></tr>
                                ) : (
                                    currentData.map(row => (
                                        <tr key={row.id}>
                                            {allColumns.map(col => {
                                                if (!visibleColumns.has(col)) return null;
                                                if (col === 'Source') {
                                                    return (
                                                        <td key={col}>
                                                            <span className={`ps-badge ${row._source==='live' ? 'src-live' : 'src-archive'}`}>
                                                                {row._source === 'live' ? 'LIVE' : 'ARCHIVE'}
                                                            </span>
                                                        </td>
                                                    );
                                                }
                                                return (
                                                    <td key={col} style={{textAlign: typeof row[col]==='number' ? 'right' : 'left'}}>
                                                        {formatValue(col, row[col])}
                                                    </td>
                                                );
                                            })}
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>

                    <div className="ps-pagination">
                        <button className="ps-page-btn" disabled={currentPage===1} onClick={() => setCurrentPage(currentPage-1)}>Previous</button>
                        <span>Page {currentPage} of {totalPages}</span>
                        <button className="ps-page-btn" disabled={currentPage===totalPages} onClick={() => setCurrentPage(currentPage+1)}>Next</button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ProjectSearch;