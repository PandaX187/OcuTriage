import { useEffect, useState } from "react";
import jsPDF from "jspdf";

const API_BASE_URL = "http://localhost:8000";

function App() {
  const [clinician, setClinician] = useState(null);
  const [authMode, setAuthMode] = useState("login");
  const [authForm, setAuthForm] = useState({
    name: "",
    email: "",
    password: "",
    department: "",
    licenseNumber: "",
  });

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

  const isMediumScreen =
    typeof window !== "undefined" ? window.innerWidth < 1100 : false;
  const isSmallScreen =
    typeof window !== "undefined" ? window.innerWidth < 768 : false;

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
    setSuccessMessage("");

    if (!authForm.email.trim() || !authForm.password.trim()) {
      setErrorMessage("Email and password are required.");
      return;
    }

    if (authMode === "register" && !authForm.name.trim()) {
      setErrorMessage("Clinician name is required.");
      return;
    }

    try {
      const endpoint = authMode === "login" ? "/login" : "/register";

      const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
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

      if (response.ok) {
        setSavedScans(data.scans || []);
      }
    } catch (error) {
      console.error("Could not load saved scans", error);
    }
  };

  const handleDeleteScan = async (scanId) => {
    const confirmed = window.confirm("Remove this saved scan? This cannot be undone.");
    if (!confirmed) return;

    try {
      const response = await fetch(`${API_BASE_URL}/scans/${scanId}`, {
        method: "DELETE",
      });

      const data = await response.json();

      if (!response.ok) {
        alert(data.message || "Could not delete scan.");
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

  const inferNumericConfidence = (diagnosis) => {
    if (!diagnosis) return 0;
    const text = diagnosis.toLowerCase();

    if (text.includes("green")) return 82;
    if (text.includes("yellow")) return 72;
    if (text.includes("red")) return 92;
    return 65;
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

      const numericConfidence =
        typeof data.confidence === "number"
          ? data.confidence
          : inferNumericConfidence(data.diagnosis);

      const confidenceLabel =
        data.confidence_label ||
        (typeof data.confidence === "number" ? "Analysis Complete" : data.confidence) ||
        "Analysis Complete";

      const riskLevel = data.risk_level || inferRiskLevel(data.diagnosis);
      const recommendation = data.recommendation || inferRecommendation(data.diagnosis);

      const analyzedResult = {
        scanId: data.scan_id,
        prediction: data.diagnosis,
        confidence: numericConfidence,
        confidenceLabel,
        recommendation,
        heatmap: data.heatmap_image,
        originalImage: data.original_image,
        qualityStatus: data.quality_status || "Accepted",
        riskLevel,
        aiExplanation:
          "The Grad-CAM heatmap highlights the retinal regions that most influenced the model's prediction. Warmer colors indicate areas of greater importance in the AI decision process.",
        qualityMetrics: data.quality_metrics || null,
      };

      setResult(analyzedResult);
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
      recommendation: scan.recommendation,
      heatmap: scan.heatmap_image,
      originalImage: scan.original_image,
      qualityStatus: scan.quality_status || "Accepted",
      riskLevel: scan.risk_level,
      aiExplanation:
        scan.ai_explanation ||
        "The Grad-CAM heatmap highlights the retinal regions that most influenced the model's prediction.",
      qualityMetrics: scan.quality_metrics || null,
    });
    setPreview(scan.original_image);
    setPage("result");
  };

  const getRiskBadgeStyle = (riskLevel) => {
    switch (riskLevel) {
      case "High":
        return {
          backgroundColor: "#fee2e2",
          color: "#b91c1c",
          border: "1px solid #fecaca",
        };
      case "Moderate":
        return {
          backgroundColor: "#fef3c7",
          color: "#b45309",
          border: "1px solid #fde68a",
        };
      case "Low":
        return {
          backgroundColor: "#dcfce7",
          color: "#15803d",
          border: "1px solid #bbf7d0",
        };
      default:
        return {
          backgroundColor: "#e2e8f0",
          color: "#334155",
          border: "1px solid #cbd5e1",
        };
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

  const getSafePatientIdForFilename = () => {
    return patientId.trim().replace(/[^a-zA-Z0-9-_]/g, "_") || "unknown-patient";
  };

  const handleExportReport = () => {
    if (!result) {
      alert("No analysis result available to export.");
      return;
    }

    if (!patientId.trim()) {
      alert("Patient ID is missing.");
      return;
    }

    const followUp = getFollowUpPlan(result);
    const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 48;
    const contentWidth = pageWidth - margin * 2;
    let y = 48;

    const checkPageBreak = (neededHeight = 40) => {
      if (y + neededHeight > pageHeight - 56) {
        doc.addPage();
        y = 48;
      }
    };

    const addFooter = () => {
      const pageCount = doc.internal.getNumberOfPages();
      for (let i = 1; i <= pageCount; i += 1) {
        doc.setPage(i);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.setTextColor(100, 116, 139);
        doc.text(`OcuTriage Report - Page ${i} of ${pageCount}`, margin, pageHeight - 28);
      }
    };

    const addSectionTitle = (title) => {
      checkPageBreak(36);
      y += 14;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(15);
      doc.setTextColor(15, 23, 42);
      doc.text(title, margin, y);
      y += 10;
      doc.setDrawColor(219, 234, 254);
      doc.line(margin, y, pageWidth - margin, y);
      y += 20;
    };

    const addField = (label, value) => {
      checkPageBreak(34);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(71, 85, 105);
      doc.text(label.toUpperCase(), margin, y);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(11);
      doc.setTextColor(15, 23, 42);
      const wrapped = doc.splitTextToSize(String(value ?? "N/A"), contentWidth - 170);
      doc.text(wrapped, margin + 170, y);
      y += Math.max(24, wrapped.length * 14);
    };

    const addParagraph = (text) => {
      checkPageBreak(60);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(11);
      doc.setTextColor(51, 65, 85);
      const wrapped = doc.splitTextToSize(String(text || "N/A"), contentWidth);
      doc.text(wrapped, margin, y);
      y += wrapped.length * 15 + 8;
    };

    const addImageBlock = (title, imageDataUrl) => {
      if (!imageDataUrl) return;
      checkPageBreak(300);
      addSectionTitle(title);

      try {
        const imageWidth = contentWidth;
        const imageHeight = 250;
        doc.addImage(imageDataUrl, "PNG", margin, y, imageWidth, imageHeight, undefined, "FAST");
        y += imageHeight + 12;
      } catch (error) {
        addParagraph("Image could not be embedded in the PDF export.");
      }
    };

    doc.setFillColor(239, 246, 255);
    doc.roundedRect(margin, y, contentWidth, 86, 14, 14, "F");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(24);
    doc.setTextColor(15, 23, 42);
    doc.text("OcuTriage Clinical Report", margin + 22, y + 34);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.setTextColor(71, 85, 105);
    doc.text(`Generated: ${new Date().toLocaleString()}`, margin + 22, y + 58);
    y += 116;

    addSectionTitle("Clinician Details");
    addField("Clinician", clinician?.name || "N/A");
    addField("Email", clinician?.email || "N/A");
    addField("Department", clinician?.department || "N/A");
    addField("License Number", clinician?.license_number || "N/A");

    addSectionTitle("Patient and Scan Details");
    addField("Patient ID", patientId);
    addField("Scan ID", result.scanId || "N/A");
    addField("Quality Status", result.qualityStatus || "N/A");
    addField("Sharpness", result.qualityMetrics?.sharpness ?? "N/A");
    addField("Brightness", result.qualityMetrics?.brightness ?? "N/A");

    addSectionTitle("AI Screening Result");
    addField("Prediction", result.prediction);
    addField("Confidence Score", `${result.confidence}%`);
    addField("Backend Status", result.confidenceLabel);
    addField("Risk Level", result.riskLevel);
    addField("Recommendation", result.recommendation);

    addSectionTitle("System Explanation");
    addParagraph(result.aiExplanation);

    checkPageBreak(230);
    addSectionTitle("Follow-up Recommendation");
    addField("Priority", followUp.priority);
    addField("Timeframe", followUp.timeframe);
    addField("Department", followUp.department);
    addField("Action", followUp.action);
    addField("Reason", followUp.reason);

    addSectionTitle("Clinical Note");
    addParagraph(patientNote || "No clinical note added.");

    addImageBlock("Original Retinal Image", preview || result?.originalImage);
    addImageBlock("Grad-CAM Heatmap", result?.heatmap);

    addFooter();
    doc.save(`ocutriage-report-${getSafePatientIdForFilename()}.pdf`);
  };

  const getFollowUpPlan = (currentResult) => {
    if (!currentResult) {
      return {
        priority: "Unavailable",
        timeframe: "Unavailable",
        department: "Unavailable",
        action: "No result available",
        reason: "No analysis has been completed yet.",
        color: {
          backgroundColor: "#f8fafc",
          color: "#334155",
          border: "1px solid #cbd5e1",
        },
      };
    }

    const prediction = (currentResult.prediction || "").toLowerCase();
    const riskLevel = (currentResult.riskLevel || "").toLowerCase();

    if (prediction.includes("green") || riskLevel === "low") {
      return {
        priority: "Low",
        timeframe: "Routine screening in 6–12 months",
        department: "General Ophthalmology / Screening",
        action: "Continue routine retinal screening",
        reason:
          "No significant diabetic retinopathy findings are indicated at this time.",
        color: {
          backgroundColor: "#dcfce7",
          color: "#166534",
          border: "1px solid #bbf7d0",
        },
      };
    }

    if (prediction.includes("yellow") || riskLevel === "moderate") {
      return {
        priority: "Moderate",
        timeframe: "Schedule follow-up within 1–3 months",
        department: "Ophthalmology Clinic",
        action: "Arrange non-urgent specialist review",
        reason:
          "Moderate retinal findings may require follow-up monitoring and specialist confirmation.",
        color: {
          backgroundColor: "#fef3c7",
          color: "#92400e",
          border: "1px solid #fde68a",
        },
      };
    }

    return {
      priority: "High",
      timeframe: "Urgent follow-up within 7 days",
      department: "Retina Specialist / Ophthalmology",
      action: "Refer patient for urgent specialist retinal evaluation",
      reason:
        "The model indicates high-risk diabetic retinopathy findings requiring prompt review.",
      color: {
        backgroundColor: "#fee2e2",
        color: "#991b1b",
        border: "1px solid #fecaca",
      },
    };
  };

  const pageShellStyle = {
    minHeight: "100vh",
    background:
      "linear-gradient(135deg, #edf4ff 0%, #f8fbff 45%, #eef7ff 100%)",
    fontFamily: "Arial, sans-serif",
    padding: "36px 20px",
    boxSizing: "border-box",
  };

  const primaryButtonStyle = {
    padding: "14px 18px",
    borderRadius: "14px",
    border: "none",
    backgroundColor: "#2563eb",
    color: "#ffffff",
    fontWeight: "bold",
    fontSize: "15px",
    cursor: "pointer",
    boxShadow: "0 10px 20px rgba(37, 99, 235, 0.18)",
  };

  const secondaryButtonStyle = {
    padding: "14px 18px",
    borderRadius: "14px",
    border: "1px solid #cbd5e1",
    backgroundColor: "#ffffff",
    color: "#0f172a",
    fontWeight: "bold",
    fontSize: "15px",
    cursor: "pointer",
  };

  const cardStyle = {
    backgroundColor: "#ffffff",
    borderRadius: "24px",
    padding: isSmallScreen ? "24px 20px" : "28px",
    boxShadow: "0 18px 40px rgba(15, 23, 42, 0.08)",
    border: "1px solid #e5eefc",
  };

  const inputStyle = {
    width: "100%",
    padding: "16px",
    borderRadius: "14px",
    border: "1px solid #cbd5e1",
    fontSize: "16px",
    boxSizing: "border-box",
    outline: "none",
  };

  const followUpPlan = getFollowUpPlan(result);

  if (page === "auth") {
    return (
      <div
        style={{
          ...pageShellStyle,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div style={{ width: "100%", maxWidth: "560px", ...cardStyle }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "10px",
              backgroundColor: "#eff6ff",
              color: "#2563eb",
              padding: "10px 16px",
              borderRadius: "999px",
              fontWeight: "bold",
              fontSize: "14px",
              marginBottom: "24px",
            }}
          >
            OCUTRIAGE CLINICIAN PORTAL
          </div>

          <h1
            style={{
              margin: "0 0 12px 0",
              color: "#0f172a",
              fontSize: isSmallScreen ? "34px" : "44px",
              lineHeight: "1.1",
              letterSpacing: "-1px",
            }}
          >
            {authMode === "login" ? "Clinician Login" : "Create Clinician Account"}
          </h1>

          <p style={{ color: "#64748b", lineHeight: "1.7", marginBottom: "26px" }}>
            Sign in to save patient scans, review previous evaluations, export reports,
            and remove saved scans when needed.
          </p>

          <div style={{ display: "grid", gap: "14px" }}>
            {authMode === "register" && (
              <>
                <input
                  value={authForm.name}
                  onChange={(e) => updateAuthForm("name", e.target.value)}
                  placeholder="Clinician full name"
                  style={inputStyle}
                />
                <input
                  value={authForm.department}
                  onChange={(e) => updateAuthForm("department", e.target.value)}
                  placeholder="Department, e.g. Ophthalmology"
                  style={inputStyle}
                />
                <input
                  value={authForm.licenseNumber}
                  onChange={(e) => updateAuthForm("licenseNumber", e.target.value)}
                  placeholder="License number"
                  style={inputStyle}
                />
              </>
            )}

            <input
              value={authForm.email}
              onChange={(e) => updateAuthForm("email", e.target.value)}
              placeholder="Email address"
              type="email"
              style={inputStyle}
            />

            <input
              value={authForm.password}
              onChange={(e) => updateAuthForm("password", e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAuthSubmit();
              }}
              placeholder="Password"
              type="password"
              style={inputStyle}
            />

            {errorMessage && (
              <div
                style={{
                  padding: "14px 16px",
                  borderRadius: "14px",
                  backgroundColor: "#fee2e2",
                  color: "#b91c1c",
                  border: "1px solid #fecaca",
                  fontWeight: "bold",
                }}
              >
                {errorMessage}
              </div>
            )}

            <button onClick={handleAuthSubmit} style={primaryButtonStyle}>
              {authMode === "login" ? "Log In" : "Create Account"}
            </button>

            <button
              onClick={() => {
                setAuthMode(authMode === "login" ? "register" : "login");
                setErrorMessage("");
              }}
              style={secondaryButtonStyle}
            >
              {authMode === "login"
                ? "Need an account? Register"
                : "Already have an account? Log in"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (page === "dashboard") {
    return (
      <div style={pageShellStyle}>
        <div style={{ maxWidth: "1200px", margin: "0 auto", display: "grid", gap: "24px" }}>
          <div style={cardStyle}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: isSmallScreen ? "flex-start" : "center",
                flexDirection: isSmallScreen ? "column" : "row",
                gap: "18px",
              }}
            >
              <div>
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "10px",
                    backgroundColor: "#eff6ff",
                    color: "#2563eb",
                    padding: "10px 16px",
                    borderRadius: "999px",
                    fontWeight: "bold",
                    fontSize: "14px",
                    marginBottom: "16px",
                  }}
                >
                  OCUTRIAGE DASHBOARD
                </div>
                <h1
                  style={{
                    margin: 0,
                    color: "#0f172a",
                    fontSize: isSmallScreen ? "38px" : "56px",
                    letterSpacing: "-2px",
                    lineHeight: "1.05",
                  }}
                >
                  Welcome, {clinician?.name || clinician?.email}
                </h1>
                <p style={{ color: "#64748b", lineHeight: "1.7", fontSize: "17px" }}>
                  Save new retinal evaluations, review previous scans, export reports,
                  or remove scans from the database.
                </p>
              </div>

              <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
                <button onClick={handleStartNewScan} style={primaryButtonStyle}>
                  New Patient Scan
                </button>
                <button onClick={handleLogout} style={secondaryButtonStyle}>
                  Log Out
                </button>
              </div>
            </div>
          </div>

          <div style={cardStyle}>
            <h2 style={{ marginTop: 0, color: "#0f172a" }}>Saved Scans</h2>

            {savedScans.length === 0 ? (
              <div
                style={{
                  padding: "24px",
                  borderRadius: "18px",
                  backgroundColor: "#f8fbff",
                  border: "1px solid #dbeafe",
                  color: "#64748b",
                  lineHeight: "1.7",
                }}
              >
                No scans have been saved yet. Start a new scan to create the first
                database record.
              </div>
            ) : (
              <div style={{ display: "grid", gap: "14px" }}>
                {savedScans.map((scan) => (
                  <div
                    key={scan.id}
                    style={{
                      display: "grid",
                      gridTemplateColumns: isMediumScreen ? "1fr" : "120px 1fr auto",
                      gap: "16px",
                      alignItems: "center",
                      padding: "16px",
                      borderRadius: "18px",
                      backgroundColor: "#f8fbff",
                      border: "1px solid #dbeafe",
                    }}
                  >
                    {scan.original_image ? (
                      <img
                        src={scan.original_image}
                        alt="Saved retinal scan"
                        style={{
                          width: "120px",
                          height: "90px",
                          objectFit: "cover",
                          borderRadius: "14px",
                          border: "1px solid #dbeafe",
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          width: "120px",
                          height: "90px",
                          borderRadius: "14px",
                          backgroundColor: "#e2e8f0",
                        }}
                      />
                    )}

                    <div>
                      <div style={{ fontWeight: "bold", color: "#0f172a", fontSize: "18px" }}>
                        Patient ID: {scan.patient_id}
                      </div>
                      <div style={{ color: "#64748b", marginTop: "6px", lineHeight: "1.6" }}>
                        Diagnosis: {scan.diagnosis} • Risk: {scan.risk_level} • Confidence: {scan.confidence}%
                      </div>
                      <div style={{ color: "#94a3b8", marginTop: "4px", fontSize: "14px" }}>
                        Saved: {scan.created_at || "N/A"}
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                      <button onClick={() => handleOpenSavedScan(scan)} style={secondaryButtonStyle}>
                        Open
                      </button>
                      <button
                        onClick={() => handleDeleteScan(scan.id)}
                        style={{
                          ...secondaryButtonStyle,
                          color: "#b91c1c",
                          border: "1px solid #fecaca",
                          backgroundColor: "#fff7f7",
                        }}
                      >
                        Remove
                      </button>
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
      <div
        style={{
          ...pageShellStyle,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div style={{ width: "100%", maxWidth: "560px", ...cardStyle }}>
          <h1 style={{ marginTop: 0, color: "#0f172a", fontSize: "42px" }}>
            Patient Details
          </h1>
          <p style={{ color: "#64748b", lineHeight: "1.7" }}>
            Enter the patient ID before uploading the retinal scan. The patient ID
            will be linked to the saved scan and exported report.
          </p>

          <div style={{ display: "grid", gap: "14px", marginTop: "22px" }}>
            <input
              value={patientId}
              onChange={(e) => setPatientId(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handlePatientContinue();
              }}
              placeholder="Patient ID, e.g. PAT-001"
              style={inputStyle}
            />

            <textarea
              value={patientNote}
              onChange={(e) => setPatientNote(e.target.value)}
              placeholder="Optional clinical note..."
              style={{
                ...inputStyle,
                minHeight: "130px",
                resize: "vertical",
                fontFamily: "Arial, sans-serif",
              }}
            />

            <button onClick={handlePatientContinue} style={primaryButtonStyle}>
              Continue to Upload
            </button>
            <button onClick={() => setPage("dashboard")} style={secondaryButtonStyle}>
              Back to Dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (page === "analyze") {
    return (
      <div style={pageShellStyle}>
        <div
          style={{
            maxWidth: "1180px",
            margin: "0 auto",
            display: "grid",
            gridTemplateColumns: isMediumScreen ? "1fr" : "1.15fr 0.85fr",
            gap: "28px",
            alignItems: "stretch",
          }}
        >
          <div
            style={{
              backgroundColor: "#ffffff",
              borderRadius: "28px",
              padding: isSmallScreen ? "32px 22px" : "52px 48px",
              boxShadow: "0 18px 40px rgba(15, 23, 42, 0.08)",
              border: "1px solid #e5eefc",
            }}
          >
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "10px",
                backgroundColor: "#eff6ff",
                color: "#2563eb",
                padding: "10px 16px",
                borderRadius: "999px",
                fontWeight: "bold",
                fontSize: "14px",
                marginBottom: "22px",
              }}
            >
              OCUTRIAGE
            </div>

            <h1
              style={{
                fontSize: isSmallScreen ? "40px" : "64px",
                lineHeight: "1.05",
                margin: "0 0 22px 0",
                color: "#0f172a",
                letterSpacing: "-2px",
                maxWidth: "760px",
              }}
            >
              Retinal Screening Analysis
            </h1>

            <p
              style={{
                fontSize: isSmallScreen ? "18px" : "22px",
                lineHeight: "1.75",
                color: "#475569",
                margin: "0 0 18px 0",
                maxWidth: "820px",
              }}
            >
              Upload a retinal fundus image to simulate diabetic retinopathy
              screening. The scan will be saved to the database under this
              clinician account.
            </p>

            <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginBottom: "34px" }}>
              <div
                style={{
                  padding: "12px 16px",
                  borderRadius: "999px",
                  backgroundColor: "#f8fbff",
                  border: "1px solid #dbeafe",
                  color: "#1e3a8a",
                  fontWeight: "bold",
                }}
              >
                Patient ID: {patientId}
              </div>
              <div
                style={{
                  padding: "12px 16px",
                  borderRadius: "999px",
                  backgroundColor: "#f8fbff",
                  border: "1px solid #dbeafe",
                  color: "#1e3a8a",
                  fontWeight: "bold",
                }}
              >
                Clinician: {clinician?.name || clinician?.email}
              </div>
            </div>

            <div
              style={{
                border: "2px dashed #93c5fd",
                borderRadius: "22px",
                padding: "28px",
                backgroundColor: "#f8fbff",
              }}
            >
              <label
                style={{
                  display: "block",
                  fontWeight: "bold",
                  marginBottom: "14px",
                  color: "#1e3a8a",
                  fontSize: "18px",
                }}
              >
                Upload Retina Image
              </label>

              <input type="file" accept="image/*" onChange={handleFileChange} />

              {preview && (
                <div style={{ marginTop: "24px" }}>
                  <h3
                    style={{
                      color: "#1e293b",
                      marginBottom: "14px",
                      fontSize: isSmallScreen ? "18px" : "22px",
                    }}
                  >
                    Image Preview
                  </h3>
                  <img
                    src={preview}
                    alt="Preview"
                    style={{
                      width: "100%",
                      maxWidth: "540px",
                      borderRadius: "20px",
                      border: "1px solid #dbeafe",
                      display: "block",
                    }}
                  />
                </div>
              )}

              <div style={{ marginTop: "24px", display: "flex", gap: "14px", flexWrap: "wrap" }}>
                <button onClick={handleAnalyze} style={primaryButtonStyle} disabled={loading}>
                  {loading ? "Analyzing and Saving..." : "Analyze and Save Scan"}
                </button>

                <button onClick={() => setPage("patient")} style={secondaryButtonStyle}>
                  Edit Patient Details
                </button>

                <button onClick={() => setPage("dashboard")} style={secondaryButtonStyle}>
                  Back to Dashboard
                </button>

                {file && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      padding: "12px 16px",
                      borderRadius: "14px",
                      backgroundColor: "#ffffff",
                      border: "1px solid #dbeafe",
                      color: "#334155",
                      fontSize: "14px",
                    }}
                  >
                    File selected successfully
                  </div>
                )}
              </div>

              {loading && (
                <p style={{ marginTop: "18px", color: "#1d4ed8", fontWeight: "bold" }}>
                  Analyzing image and saving scan...
                </p>
              )}

              {errorMessage && (
                <div
                  style={{
                    marginTop: "18px",
                    padding: "14px 16px",
                    borderRadius: "14px",
                    backgroundColor: "#fee2e2",
                    color: "#b91c1c",
                    border: "1px solid #fecaca",
                    fontWeight: "bold",
                  }}
                >
                  {errorMessage}
                </div>
              )}
            </div>
          </div>

          <div
            style={{
              backgroundColor: "#0f172a",
              borderRadius: "28px",
              padding: "34px",
              color: "white",
              boxShadow: "0 18px 40px rgba(15, 23, 42, 0.12)",
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              minHeight: isMediumScreen ? "auto" : "100%",
            }}
          >
            <div>
              <div
                style={{
                  display: "inline-block",
                  padding: "8px 14px",
                  borderRadius: "999px",
                  backgroundColor: "rgba(255,255,255,0.1)",
                  fontSize: "13px",
                  marginBottom: "18px",
                }}
              >
                Database-backed workflow
              </div>

              <h2 style={{ fontSize: isSmallScreen ? "28px" : "34px", lineHeight: "1.2", margin: "0 0 16px 0" }}>
                Save scans under clinician accounts
              </h2>

              <p style={{ color: "rgba(255,255,255,0.78)", lineHeight: "1.8", fontSize: "16px" }}>
                Each scan is linked to a clinician, patient ID, prediction, uploaded image,
                heatmap, clinical note, and report details.
              </p>
            </div>

            <div style={{ display: "grid", gap: "14px" }}>
              {["Clinician login", "Patient ID entry", "Saved scan history"].map((text, index) => (
                <div
                  key={text}
                  style={{
                    backgroundColor: "rgba(255,255,255,0.08)",
                    borderRadius: "18px",
                    padding: "18px",
                  }}
                >
                  <div style={{ fontSize: "13px", opacity: 0.7, marginBottom: "8px" }}>
                    STEP {index + 1}
                  </div>
                  <div style={{ fontSize: "22px", fontWeight: "bold" }}>{text}</div>
                </div>
              ))}
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
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "10px",
                backgroundColor: "#eff6ff",
                color: "#2563eb",
                padding: "10px 16px",
                borderRadius: "999px",
                fontWeight: "bold",
                fontSize: "14px",
              }}
            >
              OCUTRIAGE RESULT
            </div>

            <h1
              style={{
                fontSize: isSmallScreen ? "40px" : "64px",
                margin: 0,
                color: "#0f172a",
                letterSpacing: "-2px",
                lineHeight: "1.05",
              }}
            >
              Analysis Result
            </h1>

            <p style={{ margin: 0, color: "#64748b", fontSize: isSmallScreen ? "18px" : "20px", lineHeight: "1.8", maxWidth: "820px" }}>
              Review diagnosis, quality metrics, backend status, follow-up plan,
              and the Grad-CAM heatmap.
            </p>

            {successMessage && (
              <div
                style={{
                  padding: "12px 18px",
                  borderRadius: "999px",
                  fontWeight: "bold",
                  fontSize: "15px",
                  backgroundColor: "#dcfce7",
                  color: "#166534",
                  border: "1px solid #bbf7d0",
                }}
              >
                {successMessage}
              </div>
            )}

            <div
              style={{
                padding: "12px 18px",
                borderRadius: "999px",
                fontWeight: "bold",
                fontSize: "15px",
                backgroundColor: "#f8fbff",
                color: "#1e3a8a",
                border: "1px solid #dbeafe",
              }}
            >
              Patient ID: {patientId}
            </div>

            <div
              style={{
                padding: "12px 18px",
                borderRadius: "999px",
                fontWeight: "bold",
                fontSize: "15px",
                ...getRiskBadgeStyle(result?.riskLevel),
              }}
            >
              {result?.riskLevel} Risk
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: isMediumScreen ? "1fr" : "1fr 1fr", gap: "24px" }}>
          <div style={cardStyle}>
            <h3 style={{ marginTop: 0, marginBottom: "18px", color: "#0f172a", fontSize: "24px" }}>
              Uploaded Image
            </h3>

            {(preview || result?.originalImage) && (
              <img
                src={preview || result?.originalImage}
                alt="Uploaded retina"
                style={{
                  width: "100%",
                  borderRadius: "20px",
                  border: "1px solid #dbeafe",
                  display: "block",
                  marginBottom: "18px",
                  objectFit: "cover",
                  maxHeight: "380px",
                }}
              />
            )}

            <div
              style={{
                padding: "16px 18px",
                borderRadius: "16px",
                backgroundColor: "#ecfeff",
                border: "1px solid #a5f3fc",
                color: "#155e75",
                fontSize: "15px",
              }}
            >
              <strong>Quality Check:</strong> {result?.qualityStatus}
            </div>
          </div>

          <div style={{ ...cardStyle, display: "grid", gridTemplateRows: "auto auto", gap: "20px" }}>
            <div>
              <h3 style={{ marginTop: 0, marginBottom: "20px", color: "#0f172a", fontSize: "24px" }}>
                Prediction Summary
              </h3>

              <div style={{ display: "grid", gridTemplateColumns: isSmallScreen ? "1fr" : "repeat(3, 1fr)", gap: "14px", marginBottom: "24px" }}>
                <div style={{ backgroundColor: "#f8fbff", border: "1px solid #dbeafe", borderRadius: "18px", padding: "18px" }}>
                  <div style={{ fontSize: "13px", color: "#64748b", marginBottom: "10px" }}>Diagnosis</div>
                  <div style={{ fontSize: "20px", fontWeight: "bold", color: getPredictionColor(result?.prediction) }}>
                    {result?.prediction}
                  </div>
                </div>

                <div style={{ backgroundColor: "#f8fbff", border: "1px solid #dbeafe", borderRadius: "18px", padding: "18px" }}>
                  <div style={{ fontSize: "13px", color: "#64748b", marginBottom: "10px" }}>Confidence Score</div>
                  <div style={{ fontSize: "24px", fontWeight: "bold", color: getConfidenceColor(result?.confidence || 0) }}>
                    {result?.confidence}%
                  </div>
                </div>

                <div style={{ backgroundColor: "#f8fbff", border: "1px solid #dbeafe", borderRadius: "18px", padding: "18px" }}>
                  <div style={{ fontSize: "13px", color: "#64748b", marginBottom: "10px" }}>Recommendation</div>
                  <div style={{ fontSize: "16px", fontWeight: "bold", color: "#0f172a" }}>
                    {result?.recommendation}
                  </div>
                </div>
              </div>

              {result?.qualityMetrics && (
                <div style={{ backgroundColor: "#f8fbff", border: "1px solid #dbeafe", borderRadius: "18px", padding: "18px" }}>
                  <div style={{ fontWeight: "bold", color: "#0f172a", marginBottom: "10px" }}>
                    Quality Metrics
                  </div>
                  <div style={{ color: "#475569", lineHeight: "1.8" }}>
                    Sharpness: {result.qualityMetrics.sharpness}
                    <br />
                    Brightness: {result.qualityMetrics.brightness}
                  </div>
                </div>
              )}
            </div>

            <div style={{ backgroundColor: "#0f172a", borderRadius: "20px", padding: "22px", color: "white" }}>
              <div style={{ fontSize: "13px", letterSpacing: "1px", opacity: 0.7, marginBottom: "10px" }}>
                SYSTEM EXPLANATION
              </div>
              <p style={{ margin: 0, lineHeight: "1.8", color: "rgba(255,255,255,0.86)", fontSize: "15px" }}>
                {result?.aiExplanation}
              </p>
            </div>
          </div>
        </div>

        <div style={cardStyle}>
          <div style={{ textAlign: "center", maxWidth: "900px", margin: "0 auto 24px auto" }}>
            <h3 style={{ marginTop: 0, marginBottom: "12px", color: "#0f172a", fontSize: isSmallScreen ? "34px" : "48px", lineHeight: "1.1" }}>
              Grad-CAM Heatmap
            </h3>
            <p style={{ color: "#64748b", lineHeight: "1.8", margin: 0, fontSize: isSmallScreen ? "18px" : "20px" }}>
              This heatmap highlights the regions of the retina that most influenced
              the model’s prediction.
            </p>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: isMediumScreen ? "1fr" : "1fr 1fr", gap: "20px" }}>
            <div style={{ backgroundColor: "#f8fbff", border: "1px solid #dbeafe", borderRadius: "20px", padding: "18px" }}>
              <div style={{ fontWeight: "bold", color: "#0f172a", marginBottom: "12px" }}>Original Image</div>
              {(preview || result?.originalImage) && (
                <img
                  src={preview || result?.originalImage}
                  alt="Original retina"
                  style={{ width: "100%", borderRadius: "16px", border: "1px solid #dbeafe", display: "block", maxHeight: "340px", objectFit: "cover" }}
                />
              )}
            </div>

            <div style={{ backgroundColor: "#f8fbff", border: "1px solid #dbeafe", borderRadius: "20px", padding: "18px" }}>
              <div style={{ fontWeight: "bold", color: "#0f172a", marginBottom: "12px" }}>Grad-CAM Heatmap</div>
              {result?.heatmap ? (
                <img
                  src={result.heatmap}
                  alt="Grad-CAM heatmap"
                  style={{ width: "100%", borderRadius: "16px", border: "1px solid #dbeafe", display: "block", maxHeight: "340px", objectFit: "cover" }}
                />
              ) : (
                <div style={{ minHeight: "340px", borderRadius: "16px", border: "1px dashed #cbd5e1", display: "flex", alignItems: "center", justifyContent: "center", color: "#64748b" }}>
                  Grad-CAM heatmap will appear here after backend analysis
                </div>
              )}
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: isMediumScreen ? "1fr" : "1fr 0.9fr", gap: "24px" }}>
          <div style={cardStyle}>
            <h3 style={{ marginTop: 0, marginBottom: "16px", color: "#0f172a", fontSize: "24px" }}>
              Clinical Note
            </h3>
            <textarea
              value={patientNote}
              onChange={(e) => setPatientNote(e.target.value)}
              placeholder="Add a short note about the case..."
              style={{ width: "100%", minHeight: "140px", padding: "16px", borderRadius: "16px", border: "1px solid #cbd5e1", resize: "vertical", fontFamily: "Arial, sans-serif", fontSize: "15px", boxSizing: "border-box", outline: "none" }}
            />
          </div>

          <div style={cardStyle}>
            <h3 style={{ marginTop: 0, marginBottom: "16px", color: "#0f172a", fontSize: "24px" }}>
              Actions
            </h3>
            <div style={{ display: "grid", gap: "12px" }}>
              <button style={primaryButtonStyle} onClick={handleExportReport}>
                Export PDF Report
              </button>

              <button style={secondaryButtonStyle} onClick={() => setShowFollowUp((prev) => !prev)}>
                {showFollowUp ? "Hide Follow-up Plan" : "Schedule Follow-up"}
              </button>

              <button onClick={handleBack} style={secondaryButtonStyle}>
                Back to Analyze
              </button>

              <button onClick={handleReset} style={{ ...primaryButtonStyle, backgroundColor: "#0f172a" }}>
                Back to Dashboard
              </button>

              {result?.scanId && (
                <button
                  onClick={() => handleDeleteScan(result.scanId)}
                  style={{
                    ...secondaryButtonStyle,
                    color: "#b91c1c",
                    border: "1px solid #fecaca",
                    backgroundColor: "#fff7f7",
                  }}
                >
                  Remove Saved Scan
                </button>
              )}
            </div>
          </div>
        </div>

        {showFollowUp && (
          <div style={cardStyle}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: isSmallScreen ? "flex-start" : "center",
                flexDirection: isSmallScreen ? "column" : "row",
                gap: "14px",
                marginBottom: "20px",
              }}
            >
              <div>
                <h3 style={{ margin: "0 0 8px 0", color: "#0f172a", fontSize: "28px" }}>
                  Follow-up Recommendation
                </h3>
                <p style={{ margin: 0, color: "#64748b", lineHeight: "1.7", fontSize: "16px" }}>
                  Suggested next step based on the current diagnosis and risk level.
                </p>
              </div>

              <div style={{ padding: "10px 16px", borderRadius: "999px", fontWeight: "bold", fontSize: "14px", ...followUpPlan.color }}>
                {followUpPlan.priority} Priority
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: isMediumScreen ? "1fr" : "repeat(4, 1fr)", gap: "14px", marginBottom: "20px" }}>
              {[
                ["Priority", followUpPlan.priority],
                ["Timeframe", followUpPlan.timeframe],
                ["Department", followUpPlan.department],
                ["Action", followUpPlan.action],
              ].map(([label, value]) => (
                <div key={label} style={{ backgroundColor: "#f8fbff", border: "1px solid #dbeafe", borderRadius: "18px", padding: "18px" }}>
                  <div style={{ fontSize: "13px", color: "#64748b", marginBottom: "10px" }}>{label}</div>
                  <div style={{ fontWeight: "bold", color: label === "Priority" ? followUpPlan.color.color : "#0f172a" }}>
                    {value}
                  </div>
                </div>
              ))}
            </div>

            <div style={{ padding: "18px 20px", borderRadius: "18px", ...followUpPlan.color }}>
              <strong style={{ display: "block", marginBottom: "8px" }}>Reason</strong>
              <span>{followUpPlan.reason}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
