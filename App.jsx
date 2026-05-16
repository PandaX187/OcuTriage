import { useEffect, useState } from "react";
import jsPDF from "jspdf";

const API_BASE_URL = "http://localhost:8000";

function App() {
  const [clinician, setClinician] = useState(null);
  const [authForm, setAuthForm] = useState({ email: "", password: "" });
  
  // Admin State
  const [allClinicians, setAllClinicians] = useState([]);
  const [newClinicianForm, setNewClinicianForm] = useState({ name: "", email: "", password: "", department: "", licenseNumber: "" });
  const [adminMessage, setAdminMessage] = useState("");

  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [page, setPage] = useState("auth");
  const [patientId, setPatientId] = useState("");
  const [patientNote, setPatientNote] = useState("");
  const [showFollowUp, setShowFollowUp] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [savedScans, setSavedScans] = useState([]);
  const [selectedScan, setSelectedScan] = useState(null);

  const isMediumScreen = typeof window !== "undefined" ? window.innerWidth < 1100 : false;
  const isSmallScreen = typeof window !== "undefined" ? window.innerWidth < 768 : false;

  useEffect(() => {
    const storedClinician = localStorage.getItem("ocutriage_clinician");
    if (storedClinician) {
      const parsedClinician = JSON.parse(storedClinician);
      setClinician(parsedClinician);
      setPage("dashboard");
      loadSavedScans(parsedClinician.id);
    }
  }, []);

  const updateAuthForm = (field, value) => {
    setAuthForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleAuthSubmit = async () => {
    setErrorMessage("");
    if (!authForm.email.trim() || !authForm.password.trim()) {
      setErrorMessage("Email and password are required.");
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(authForm),
      });

      const data = await response.json();

      if (!response.ok) {
        setErrorMessage(data.message || "Authentication failed.");
        return;
      }

      setClinician(data.clinician);
      localStorage.setItem("ocutriage_clinician", JSON.stringify(data.clinician));
      setPage("dashboard");
      loadSavedScans(data.clinician.id);
    } catch (error) {
      setErrorMessage("Could not connect to backend. Make sure app.py is running.");
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("ocutriage_clinician");
    setClinician(null);
    setSavedScans([]);
    setSelectedScan(null);
    setResult(null);
    setPatientId("");
    setPatientNote("");
    setFile(null);
    setPreview(null);
    setPage("auth");
  };

  const loadSavedScans = async (clinicianId) => {
    if (!clinicianId) return;
    try {
      const response = await fetch(`${API_BASE_URL}/clinicians/${clinicianId}/scans`);
      const data = await response.json();
      if (response.ok) setSavedScans(data.scans || []);
    } catch (error) {
      console.error("Could not load saved scans", error);
    }
  };

  // --- ADMIN FUNCTIONS ---
  const loadAllClinicians = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/clinicians`);
      const data = await response.json();
      if (response.ok) setAllClinicians(data.clinicians || []);
    } catch (error) {
      console.error("Failed to load clinicians", error);
    }
  };

  const handleAdminRegisterClinician = async () => {
    setAdminMessage("");
    if (!newClinicianForm.name || !newClinicianForm.email || !newClinicianForm.password) {
      setAdminMessage("Name, Email, and Password are required.");
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newClinicianForm),
      });

      const data = await response.json();
      if (!response.ok) {
        setAdminMessage(data.message || "Failed to create clinician.");
        return;
      }

      setAdminMessage(`Account for ${newClinicianForm.name} created successfully.`);
      setNewClinicianForm({ name: "", email: "", password: "", department: "", licenseNumber: "" });
      loadAllClinicians();
    } catch (error) {
      setAdminMessage("Server error during registration.");
    }
  };

  const handleAdminDeleteClinician = async (targetId) => {
    const confirmed = window.confirm("Are you sure? This will delete the clinician AND all their saved patient scans.");
    if (!confirmed) return;

    try {
      const response = await fetch(`${API_BASE_URL}/clinicians/${targetId}`, { method: "DELETE" });
      if (response.ok) {
        loadAllClinicians();
        setAdminMessage("Clinician removed successfully.");
      }
    } catch (error) {
      setAdminMessage("Failed to connect to backend to remove clinician.");
    }
  };
  // -----------------------

  const handleDeleteScan = async (scanId) => {
    const confirmed = window.confirm("Remove this saved scan? This cannot be undone.");
    if (!confirmed) return;
    try {
      const response = await fetch(`${API_BASE_URL}/scans/${scanId}`, { method: "DELETE" });
      if (!response.ok) {
        alert("Could not delete scan.");
        return;
      }
      setSavedScans((prev) => prev.filter((scan) => scan.id !== scanId));
      if (selectedScan?.id === scanId) {
        setSelectedScan(null);
        setResult(null);
        setPage("dashboard");
      }
    } catch (error) {
      alert("Could not connect to backend.");
    }
  };

  const handleStartNewScan = () => {
    setFile(null);
    setPreview(null);
    setLoading(false);
    setResult(null);
    setPatientId("");
    setPatientNote("");
    setShowFollowUp(false);
    setErrorMessage("");
    setSuccessMessage("");
    setSelectedScan(null);
    setPage("patient");
  };

  const handlePatientContinue = () => {
    if (!patientId.trim()) {
      alert("Please enter a patient ID.");
      return;
    }
    setPage("analyze");
  };

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    if (!selectedFile) return;
    setFile(selectedFile);
    setResult(null);
    setErrorMessage("");
    setSuccessMessage("");
    setPreview(URL.createObjectURL(selectedFile));
  };

  const inferRiskLevel = (diagnosis) => {
    if (!diagnosis) return "Unknown";
    const text = diagnosis.toLowerCase();
    if (text.includes("green")) return "Low";
    if (text.includes("yellow")) return "Moderate";
    if (text.includes("red")) return "High";
    return "Unknown";
  };

  const inferRecommendation = (diagnosis) => {
    if (!diagnosis) return "Awaiting analysis";
    const text = diagnosis.toLowerCase();
    if (text.includes("green")) return "Routine screening recommended";
    if (text.includes("yellow")) return "Schedule ophthalmology follow-up";
    if (text.includes("red")) return "Refer to specialist urgently";
    return "Clinical review recommended";
  };

  const handleAnalyze = async () => {
    if (!clinician?.id) {
      alert("Please log in first.");
      setPage("auth");
      return;
    }
    if (!patientId.trim()) {
      alert("Please enter a patient ID first.");
      setPage("patient");
      return;
    }
    if (!file) {
      alert("Please upload an image first.");
      return;
    }

    setLoading(true);
    setResult(null);
    setErrorMessage("");
    setSuccessMessage("");
    setShowFollowUp(false);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("patient_id", patientId.trim());
      formData.append("clinician_id", clinician.id);
      formData.append("clinical_note", patientNote);

      const response = await fetch(`${API_BASE_URL}/predict`, {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        setErrorMessage(data.message || "Analysis failed.");
        setLoading(false);
        return;
      }

      const riskLevel = data.risk_level || inferRiskLevel(data.diagnosis);
      const recommendation = data.recommendation || inferRecommendation(data.diagnosis);

      setResult({
        scanId: data.scan_id,
        prediction: data.diagnosis,
        confidence: data.confidence,
        confidenceLabel: data.confidence_label,
        recommendation,
        heatmap: data.heatmap_image,
        originalImage: data.original_image,
        qualityStatus: data.quality_status || "Accepted",
        riskLevel,
        aiExplanation: "The Grad-CAM heatmap highlights the retinal regions that most influenced the model's prediction.",
        qualityMetrics: data.quality_metrics || null,
      });
      setSuccessMessage("Scan saved successfully to the clinician dashboard.");
      setPage("result");
      loadSavedScans(clinician.id);
    } catch (error) {
      setErrorMessage("Could not connect to backend. Make sure app.py is running.");
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setFile(null);
    setPreview(null);
    setLoading(false);
    setResult(null);
    setPage("dashboard");
    setPatientId("");
    setPatientNote("");
    setShowFollowUp(false);
    setErrorMessage("");
    setSuccessMessage("");
    setSelectedScan(null);
  };

  const handleBack = () => {
    setPage("analyze");
    setShowFollowUp(false);
  };

  const handleOpenSavedScan = (scan) => {
    setSelectedScan(scan);
    setPatientId(scan.patient_id || "");
    setPatientNote(scan.clinical_note || "");
    setResult({
      scanId: scan.id,
      prediction: scan.diagnosis,
      confidence: scan.confidence,
      confidenceLabel: scan.backend_status || "Analysis Complete",
      recommendation: scan.recommendation || inferRecommendation(scan.diagnosis),
      heatmap: scan.heatmap_image,
      originalImage: scan.original_image,
      qualityStatus: scan.quality_status || "Accepted",
      riskLevel: scan.risk_level || inferRiskLevel(scan.diagnosis),
      aiExplanation: scan.ai_explanation || "The Grad-CAM heatmap highlights the retinal regions that most influenced the model's prediction.",
      qualityMetrics: scan.quality_metrics || null,
    });
    setPreview(scan.original_image);
    setPage("result");
  };

  const getRiskBadgeStyle = (riskLevel) => {
    switch (riskLevel) {
      case "High": return { backgroundColor: "#fee2e2", color: "#b91c1c", border: "1px solid #fecaca" };
      case "Moderate": return { backgroundColor: "#fef3c7", color: "#b45309", border: "1px solid #fde68a" };
      case "Low": return { backgroundColor: "#dcfce7", color: "#15803d", border: "1px solid #bbf7d0" };
      default: return { backgroundColor: "#e2e8f0", color: "#334155", border: "1px solid #cbd5e1" };
    }
  };

  const getPredictionColor = (prediction) => {
    if (!prediction) return "#334155";
    const text = prediction.toLowerCase();
    if (text.includes("green")) return "#15803d";
    if (text.includes("yellow")) return "#b45309";
    if (text.includes("red")) return "#dc2626";
    return "#334155";
  };

  const getConfidenceColor = (confidence) => {
    if (confidence >= 85) return "#2563eb";
    if (confidence >= 60) return "#d97706";
    return "#dc2626";
  };

  const getSafePatientIdForFilename = () => patientId.trim().replace(/[^a-zA-Z0-9-_]/g, "_") || "unknown-patient";

  const handleExportReport = () => {
    if (!result || !patientId.trim()) return;
    const followUp = getFollowUpPlan(result);
    const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });

    const margin = 48;
    const contentWidth = doc.internal.pageSize.getWidth() - margin * 2;
    let y = 48;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(24);
    doc.text("OcuTriage Clinical Report", margin, y);
    y += 40;

    doc.setFontSize(12);
    doc.text(`Patient ID: ${patientId}`, margin, y);
    y += 20;
    doc.text(`Clinician: ${clinician?.name || "N/A"}`, margin, y);
    y += 40;

    doc.text(`Diagnosis: ${result.prediction}`, margin, y);
    y += 20;
    doc.text(`Confidence: ${result.confidence}%`, margin, y);
    y += 20;
    doc.text(`Recommendation: ${result.recommendation}`, margin, y);
    
    doc.save(`ocutriage-report-${getSafePatientIdForFilename()}.pdf`);
  };

  const getFollowUpPlan = (currentResult) => {
    if (!currentResult) return { priority: "Unavailable", timeframe: "Unavailable", department: "Unavailable", action: "No result", reason: "N/A", color: { backgroundColor: "#f8fafc", color: "#334155" } };
    const prediction = (currentResult.prediction || "").toLowerCase();
    
    if (prediction.includes("green")) return { priority: "Low", timeframe: "Routine screening in 6–12 months", department: "General Ophthalmology", action: "Continue routine screening", reason: "No significant DR findings.", color: { backgroundColor: "#dcfce7", color: "#166534" } };
    if (prediction.includes("yellow")) return { priority: "Moderate", timeframe: "Schedule follow-up within 1–3 months", department: "Ophthalmology Clinic", action: "Arrange specialist review", reason: "Moderate findings require monitoring.", color: { backgroundColor: "#fef3c7", color: "#92400e" } };
    return { priority: "High", timeframe: "Urgent follow-up within 7 days", department: "Retina Specialist", action: "Refer for urgent evaluation", reason: "High-risk findings requiring prompt review.", color: { backgroundColor: "#fee2e2", color: "#991b1b" } };
  };

  const pageShellStyle = { minHeight: "100vh", background: "linear-gradient(135deg, #edf4ff 0%, #f8fbff 45%, #eef7ff 100%)", fontFamily: "Arial, sans-serif", padding: "36px 20px", boxSizing: "border-box" };
  const primaryButtonStyle = { padding: "14px 18px", borderRadius: "14px", border: "none", backgroundColor: "#2563eb", color: "#ffffff", fontWeight: "bold", fontSize: "15px", cursor: "pointer", boxShadow: "0 10px 20px rgba(37, 99, 235, 0.18)" };
  const secondaryButtonStyle = { padding: "14px 18px", borderRadius: "14px", border: "1px solid #cbd5e1", backgroundColor: "#ffffff", color: "#0f172a", fontWeight: "bold", fontSize: "15px", cursor: "pointer" };
  const cardStyle = { backgroundColor: "#ffffff", borderRadius: "24px", padding: isSmallScreen ? "24px 20px" : "28px", boxShadow: "0 18px 40px rgba(15, 23, 42, 0.08)", border: "1px solid #e5eefc" };
  const inputStyle = { width: "100%", padding: "16px", borderRadius: "14px", border: "1px solid #cbd5e1", fontSize: "16px", boxSizing: "border-box", outline: "none" };

  if (page === "auth") {
    return (
      <div style={{ ...pageShellStyle, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ width: "100%", maxWidth: "560px", ...cardStyle }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: "10px", backgroundColor: "#eff6ff", color: "#2563eb", padding: "10px 16px", borderRadius: "999px", fontWeight: "bold", fontSize: "14px", marginBottom: "24px" }}>
            OCUTRIAGE CLINICIAN PORTAL
          </div>
          <h1 style={{ margin: "0 0 12px 0", color: "#0f172a", fontSize: isSmallScreen ? "34px" : "44px", lineHeight: "1.1", letterSpacing: "-1px" }}>
            Clinician Login
          </h1>
          <p style={{ color: "#64748b", lineHeight: "1.7", marginBottom: "26px" }}>
            System access is restricted to authorized personnel. To request an account, please contact the system administrator.
          </p>

          <div style={{ display: "grid", gap: "14px" }}>
            <input value={authForm.email} onChange={(e) => updateAuthForm("email", e.target.value)} placeholder="Email address" type="email" style={inputStyle} />
            <input value={authForm.password} onChange={(e) => updateAuthForm("password", e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") handleAuthSubmit(); }} placeholder="Password" type="password" style={inputStyle} />
            
            {errorMessage && (
              <div style={{ padding: "14px 16px", borderRadius: "14px", backgroundColor: "#fee2e2", color: "#b91c1c", border: "1px solid #fecaca", fontWeight: "bold" }}>
                {errorMessage}
              </div>
            )}
            <button onClick={handleAuthSubmit} style={primaryButtonStyle}>Log In</button>
          </div>
        </div>
      </div>
    );
  }

  // --- NEW ADMIN DASHBOARD PAGE ---
  if (page === "admin") {
    return (
      <div style={pageShellStyle}>
        <div style={{ maxWidth: "1200px", margin: "0 auto", display: "grid", gap: "24px" }}>
          <div style={cardStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "14px" }}>
              <div>
                <div style={{ display: "inline-flex", alignItems: "center", gap: "10px", backgroundColor: "#fef2f2", color: "#dc2626", padding: "10px 16px", borderRadius: "999px", fontWeight: "bold", fontSize: "14px", marginBottom: "16px" }}>
                  ADMINISTRATOR CONSOLE
                </div>
                <h1 style={{ margin: 0, color: "#0f172a", fontSize: isSmallScreen ? "32px" : "48px", letterSpacing: "-1px" }}>
                  System Management
                </h1>
              </div>
              <button onClick={() => setPage("dashboard")} style={secondaryButtonStyle}>Back to My Dashboard</button>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: isMediumScreen ? "1fr" : "1fr 1.5fr", gap: "24px" }}>
            <div style={{ ...cardStyle, alignSelf: "start" }}>
              <h2 style={{ marginTop: 0, color: "#0f172a" }}>Register New Clinician</h2>
              <p style={{ color: "#64748b", marginBottom: "20px" }}>Create accounts for authorized clinical staff.</p>
              
              <div style={{ display: "grid", gap: "12px" }}>
                <input value={newClinicianForm.name} onChange={(e) => setNewClinicianForm({...newClinicianForm, name: e.target.value})} placeholder="Full Name" style={inputStyle} />
                <input value={newClinicianForm.email} onChange={(e) => setNewClinicianForm({...newClinicianForm, email: e.target.value})} placeholder="Email Address" type="email" style={inputStyle} />
                <input value={newClinicianForm.password} onChange={(e) => setNewClinicianForm({...newClinicianForm, password: e.target.value})} placeholder="Password" type="password" style={inputStyle} />
                <input value={newClinicianForm.department} onChange={(e) => setNewClinicianForm({...newClinicianForm, department: e.target.value})} placeholder="Department (e.g. Retina)" style={inputStyle} />
                <input value={newClinicianForm.licenseNumber} onChange={(e) => setNewClinicianForm({...newClinicianForm, licenseNumber: e.target.value})} placeholder="Medical License Number" style={inputStyle} />
                
                {adminMessage && (
                  <div style={{ padding: "12px", borderRadius: "10px", backgroundColor: adminMessage.includes("success") ? "#dcfce7" : "#fee2e2", color: adminMessage.includes("success") ? "#166534" : "#b91c1c", fontWeight: "bold", fontSize: "14px" }}>
                    {adminMessage}
                  </div>
                )}
                <button onClick={handleAdminRegisterClinician} style={{ ...primaryButtonStyle, backgroundColor: "#0f172a" }}>Create Account</button>
              </div>
            </div>

            <div style={cardStyle}>
              <h2 style={{ marginTop: 0, color: "#0f172a" }}>Authorized Clinicians</h2>
              <p style={{ color: "#64748b", marginBottom: "20px" }}>Manage currently active accounts across the system.</p>
              
              <div style={{ display: "grid", gap: "14px" }}>
                {allClinicians.map((c) => (
                  <div key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px", borderRadius: "16px", backgroundColor: "#f8fbff", border: "1px solid #dbeafe" }}>
                    <div>
                      <div style={{ fontWeight: "bold", fontSize: "16px", color: "#0f172a" }}>{c.name} {c.email === "rayan@ocutriage.com" && "(System Admin)"}</div>
                      <div style={{ color: "#64748b", fontSize: "14px", marginTop: "4px" }}>{c.email} • {c.department || "No Dept"}</div>
                    </div>
                    {c.email !== "rayan@ocutriage.com" && (
                      <button onClick={() => handleAdminDeleteClinician(c.id)} style={{ padding: "8px 14px", borderRadius: "10px", backgroundColor: "#fff7f7", border: "1px solid #fecaca", color: "#b91c1c", fontWeight: "bold", cursor: "pointer" }}>
                        Revoke Access
                      </button>
                    )}
                  </div>
                ))}
                {allClinicians.length === 0 && <div style={{ color: "#64748b" }}>Loading clinicians...</div>}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
  // --------------------------------

  if (page === "dashboard") {
    return (
      <div style={pageShellStyle}>
        <div style={{ maxWidth: "1200px", margin: "0 auto", display: "grid", gap: "24px" }}>
          <div style={cardStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: isSmallScreen ? "flex-start" : "center", flexDirection: isSmallScreen ? "column" : "row", gap: "18px" }}>
              <div>
                <div style={{ display: "inline-flex", alignItems: "center", gap: "10px", backgroundColor: "#eff6ff", color: "#2563eb", padding: "10px 16px", borderRadius: "999px", fontWeight: "bold", fontSize: "14px", marginBottom: "16px" }}>
                  OCUTRIAGE DASHBOARD
                </div>
                <h1 style={{ margin: 0, color: "#0f172a", fontSize: isSmallScreen ? "38px" : "56px", letterSpacing: "-2px", lineHeight: "1.05" }}>
                  Welcome, {clinician?.name || clinician?.email}
                </h1>
              </div>
              <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
                
                {/* --- ADMIN BUTTON INJECTION --- */}
                {clinician?.email === "rayan@ocutriage.com" && (
                  <button onClick={() => { setPage("admin"); loadAllClinicians(); }} style={{ ...primaryButtonStyle, backgroundColor: "#0f172a" }}>
                    Admin Panel
                  </button>
                )}
                {/* ----------------------------- */}

                <button onClick={handleStartNewScan} style={primaryButtonStyle}>New Patient Scan</button>
                <button onClick={handleLogout} style={secondaryButtonStyle}>Log Out</button>
              </div>
            </div>
          </div>

          <div style={cardStyle}>
            <h2 style={{ marginTop: 0, color: "#0f172a" }}>Saved Scans</h2>
            {savedScans.length === 0 ? (
              <div style={{ padding: "24px", borderRadius: "18px", backgroundColor: "#f8fbff", border: "1px solid #dbeafe", color: "#64748b", lineHeight: "1.7" }}>
                No scans have been saved yet. Start a new scan to create the first database record.
              </div>
            ) : (
              <div style={{ display: "grid", gap: "14px" }}>
                {savedScans.map((scan) => (
                  <div key={scan.id} style={{ display: "grid", gridTemplateColumns: isMediumScreen ? "1fr" : "120px 1fr auto", gap: "16px", alignItems: "center", padding: "16px", borderRadius: "18px", backgroundColor: "#f8fbff", border: "1px solid #dbeafe" }}>
                    {scan.original_image ? (
                      <img src={scan.original_image} alt="Saved retinal scan" style={{ width: "120px", height: "90px", objectFit: "cover", borderRadius: "14px", border: "1px solid #dbeafe" }} />
                    ) : (
                      <div style={{ width: "120px", height: "90px", borderRadius: "14px", backgroundColor: "#e2e8f0" }} />
                    )}
                    <div>
                      <div style={{ fontWeight: "bold", color: "#0f172a", fontSize: "18px" }}>Patient ID: {scan.patient_id}</div>
                      <div style={{ color: "#64748b", marginTop: "6px", lineHeight: "1.6" }}>Diagnosis: {scan.diagnosis} • Risk: {scan.risk_level} • Confidence: {scan.confidence}%</div>
                      <div style={{ color: "#94a3b8", marginTop: "4px", fontSize: "14px" }}>Saved: {scan.created_at || "N/A"}</div>
                    </div>
                    <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                      <button onClick={() => handleOpenSavedScan(scan)} style={secondaryButtonStyle}>Open</button>
                      <button onClick={() => handleDeleteScan(scan.id)} style={{ ...secondaryButtonStyle, color: "#b91c1c", border: "1px solid #fecaca", backgroundColor: "#fff7f7" }}>Remove</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (page === "patient") {
    return (
      <div style={{ ...pageShellStyle, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ width: "100%", maxWidth: "560px", ...cardStyle }}>
          <h1 style={{ marginTop: 0, color: "#0f172a", fontSize: "42px" }}>Patient Details</h1>
          <p style={{ color: "#64748b", lineHeight: "1.7" }}>Enter the patient ID before uploading the retinal scan.</p>
          <div style={{ display: "grid", gap: "14px", marginTop: "22px" }}>
            <input value={patientId} onChange={(e) => setPatientId(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") handlePatientContinue(); }} placeholder="Patient ID, e.g. PAT-001" style={inputStyle} />
            <textarea value={patientNote} onChange={(e) => setPatientNote(e.target.value)} placeholder="Optional clinical note..." style={{ ...inputStyle, minHeight: "130px", resize: "vertical" }} />
            <button onClick={handlePatientContinue} style={primaryButtonStyle}>Continue to Upload</button>
            <button onClick={() => setPage("dashboard")} style={secondaryButtonStyle}>Back to Dashboard</button>
          </div>
        </div>
      </div>
    );
  }

  if (page === "analyze") {
    return (
      <div style={pageShellStyle}>
        <div style={{ maxWidth: "1180px", margin: "0 auto", display: "grid", gridTemplateColumns: isMediumScreen ? "1fr" : "1.15fr 0.85fr", gap: "28px", alignItems: "stretch" }}>
          <div style={{ backgroundColor: "#ffffff", borderRadius: "28px", padding: isSmallScreen ? "32px 22px" : "52px 48px", boxShadow: "0 18px 40px rgba(15, 23, 42, 0.08)", border: "1px solid #e5eefc" }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: "10px", backgroundColor: "#eff6ff", color: "#2563eb", padding: "10px 16px", borderRadius: "999px", fontWeight: "bold", fontSize: "14px", marginBottom: "22px" }}>OCUTRIAGE</div>
            <h1 style={{ fontSize: isSmallScreen ? "40px" : "64px", lineHeight: "1.05", margin: "0 0 22px 0", color: "#0f172a", letterSpacing: "-2px" }}>Retinal Screening</h1>
            <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginBottom: "34px" }}>
              <div style={{ padding: "12px 16px", borderRadius: "999px", backgroundColor: "#f8fbff", border: "1px solid #dbeafe", color: "#1e3a8a", fontWeight: "bold" }}>Patient ID: {patientId}</div>
            </div>

            <div style={{ border: "2px dashed #93c5fd", borderRadius: "22px", padding: "28px", backgroundColor: "#f8fbff" }}>
              <label style={{ display: "block", fontWeight: "bold", marginBottom: "14px", color: "#1e3a8a", fontSize: "18px" }}>Upload Retina Image</label>
              <input type="file" accept="image/*" onChange={handleFileChange} />
              
              {preview && (
                <div style={{ marginTop: "24px" }}>
                  <img src={preview} alt="Preview" style={{ width: "100%", maxWidth: "540px", borderRadius: "20px", border: "1px solid #dbeafe", display: "block" }} />
                </div>
              )}

              <div style={{ marginTop: "24px", display: "flex", gap: "14px", flexWrap: "wrap" }}>
                <button onClick={handleAnalyze} style={primaryButtonStyle} disabled={loading}>{loading ? "Analyzing..." : "Analyze Scan"}</button>
                <button onClick={() => setPage("patient")} style={secondaryButtonStyle}>Edit Patient</button>
                <button onClick={() => setPage("dashboard")} style={secondaryButtonStyle}>Dashboard</button>
              </div>

              {errorMessage && (
                <div style={{ marginTop: "18px", padding: "14px 16px", borderRadius: "14px", backgroundColor: "#fee2e2", color: "#b91c1c", border: "1px solid #fecaca", fontWeight: "bold" }}>
                  {errorMessage}
                </div>
              )}
            </div>
          </div>

          <div style={{ backgroundColor: "#0f172a", borderRadius: "28px", padding: "34px", color: "white", boxShadow: "0 18px 40px rgba(15, 23, 42, 0.12)", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
            <div>
              <div style={{ display: "inline-block", padding: "8px 14px", borderRadius: "999px", backgroundColor: "rgba(255,255,255,0.1)", fontSize: "13px", marginBottom: "18px" }}>Strict Image Validation Enabled</div>
              <h2 style={{ fontSize: isSmallScreen ? "28px" : "34px", lineHeight: "1.2", margin: "0 0 16px 0" }}>Clinical Precision</h2>
              <p style={{ color: "rgba(255,255,255,0.78)", lineHeight: "1.8", fontSize: "16px" }}>The API automatically checks for blur, lighting issues, and validates that the image matches standard retinal fundus morphology before processing.</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={pageShellStyle}>
      <div style={{ maxWidth: "1200px", margin: "0 auto", display: "grid", gap: "24px" }}>
        <div style={cardStyle}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: "14px" }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: "10px", backgroundColor: "#eff6ff", color: "#2563eb", padding: "10px 16px", borderRadius: "999px", fontWeight: "bold", fontSize: "14px" }}>OCUTRIAGE RESULT</div>
            <h1 style={{ fontSize: isSmallScreen ? "40px" : "64px", margin: 0, color: "#0f172a", letterSpacing: "-2px", lineHeight: "1.05" }}>Analysis Result</h1>
            <div style={{ padding: "12px 18px", borderRadius: "999px", fontWeight: "bold", fontSize: "15px", ...getRiskBadgeStyle(result?.riskLevel) }}>{result?.riskLevel} Risk</div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: isMediumScreen ? "1fr" : "1fr 1fr", gap: "24px" }}>
          <div style={cardStyle}>
            <h3 style={{ marginTop: 0, marginBottom: "18px", color: "#0f172a", fontSize: "24px" }}>Uploaded Image</h3>
            {(preview || result?.originalImage) && <img src={preview || result?.originalImage} alt="Uploaded retina" style={{ width: "100%", borderRadius: "20px", border: "1px solid #dbeafe", display: "block", marginBottom: "18px", objectFit: "cover", maxHeight: "380px" }} />}
            <div style={{ padding: "16px 18px", borderRadius: "16px", backgroundColor: "#ecfeff", border: "1px solid #a5f3fc", color: "#155e75", fontSize: "15px" }}>
              <strong>Quality Check:</strong> {result?.qualityStatus}
            </div>
          </div>

          <div style={{ ...cardStyle, display: "grid", gridTemplateRows: "auto auto", gap: "20px" }}>
            <div>
              <h3 style={{ marginTop: 0, marginBottom: "20px", color: "#0f172a", fontSize: "24px" }}>Prediction Summary</h3>
              <div style={{ display: "grid", gridTemplateColumns: isSmallScreen ? "1fr" : "repeat(3, 1fr)", gap: "14px", marginBottom: "24px" }}>
                <div style={{ backgroundColor: "#f8fbff", border: "1px solid #dbeafe", borderRadius: "18px", padding: "18px" }}>
                  <div style={{ fontSize: "13px", color: "#64748b", marginBottom: "10px" }}>Diagnosis</div>
                  <div style={{ fontSize: "20px", fontWeight: "bold", color: getPredictionColor(result?.prediction) }}>{result?.prediction}</div>
                </div>
                <div style={{ backgroundColor: "#f8fbff", border: "1px solid #dbeafe", borderRadius: "18px", padding: "18px" }}>
                  <div style={{ fontSize: "13px", color: "#64748b", marginBottom: "10px" }}>Confidence Score</div>
                  <div style={{ fontSize: "24px", fontWeight: "bold", color: getConfidenceColor(result?.confidence || 0) }}>{result?.confidence}%</div>
                </div>
                <div style={{ backgroundColor: "#f8fbff", border: "1px solid #dbeafe", borderRadius: "18px", padding: "18px" }}>
                  <div style={{ fontSize: "13px", color: "#64748b", marginBottom: "10px" }}>Recommendation</div>
                  <div style={{ fontSize: "16px", fontWeight: "bold", color: "#0f172a" }}>{result?.recommendation}</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div style={cardStyle}>
          <div style={{ textAlign: "center", maxWidth: "900px", margin: "0 auto 24px auto" }}>
            <h3 style={{ marginTop: 0, marginBottom: "12px", color: "#0f172a", fontSize: isSmallScreen ? "34px" : "48px", lineHeight: "1.1" }}>Grad-CAM Heatmap</h3>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: isMediumScreen ? "1fr" : "1fr 1fr", gap: "20px" }}>
            <div style={{ backgroundColor: "#f8fbff", border: "1px solid #dbeafe", borderRadius: "20px", padding: "18px" }}>
              <div style={{ fontWeight: "bold", color: "#0f172a", marginBottom: "12px" }}>Original Image</div>
              {(preview || result?.originalImage) && <img src={preview || result?.originalImage} alt="Original retina" style={{ width: "100%", borderRadius: "16px", border: "1px solid #dbeafe", display: "block", maxHeight: "340px", objectFit: "cover" }} />}
            </div>
            <div style={{ backgroundColor: "#f8fbff", border: "1px solid #dbeafe", borderRadius: "20px", padding: "18px" }}>
              <div style={{ fontWeight: "bold", color: "#0f172a", marginBottom: "12px" }}>Grad-CAM Heatmap</div>
              {result?.heatmap && <img src={result.heatmap} alt="Grad-CAM heatmap" style={{ width: "100%", borderRadius: "16px", border: "1px solid #dbeafe", display: "block", maxHeight: "340px", objectFit: "cover" }} />}
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: isMediumScreen ? "1fr" : "1fr 0.9fr", gap: "24px" }}>
          <div style={cardStyle}>
            <h3 style={{ marginTop: 0, marginBottom: "16px", color: "#0f172a", fontSize: "24px" }}>Actions</h3>
            <div style={{ display: "grid", gap: "12px" }}>
              <button style={primaryButtonStyle} onClick={handleExportReport}>Export PDF Report</button>
              <button onClick={handleReset} style={{ ...primaryButtonStyle, backgroundColor: "#0f172a" }}>Back to Dashboard</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
