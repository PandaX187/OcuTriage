import { useState } from "react";

function App() {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [page, setPage] = useState("analyze");
  const [patientNote, setPatientNote] = useState("");
  const [showFollowUp, setShowFollowUp] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const isMediumScreen =
    typeof window !== "undefined" ? window.innerWidth < 1100 : false;
  const isSmallScreen =
    typeof window !== "undefined" ? window.innerWidth < 768 : false;

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    if (!selectedFile) return;

    setFile(selectedFile);
    setResult(null);
    setErrorMessage("");
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
    if (!file) {
      alert("Please upload an image first.");
      return;
    }

    setLoading(true);
    setResult(null);
    setErrorMessage("");
    setShowFollowUp(false);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("http://localhost:8000/predict", {
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
        typeof data.confidence === "number"
          ? "Analysis Complete"
          : data.confidence || "Analysis Complete";

      const riskLevel = inferRiskLevel(data.diagnosis);
      const recommendation = inferRecommendation(data.diagnosis);

      setResult({
        prediction: data.diagnosis,
        confidence: numericConfidence,
        confidenceLabel,
        recommendation,
        heatmap: data.heatmap_image,
        qualityStatus: "Accepted",
        riskLevel,
        aiExplanation:
          "The Grad-CAM heatmap highlights the retinal regions that most influenced the model's prediction. Warmer colors indicate areas of greater importance in the AI decision process.",
        qualityMetrics: data.quality_metrics || null,
      });

      setPage("result");
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
    setPage("analyze");
    setPatientNote("");
    setShowFollowUp(false);
    setErrorMessage("");
  };

  const handleBack = () => {
    setPage("analyze");
    setShowFollowUp(false);
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

  const handleExportReport = () => {
    if (!result) {
      alert("No analysis result available to export.");
      return;
    }

    const followUp = getFollowUpPlan(result);

    const reportText = `
OCUTRIAGE REPORT
========================

Prediction: ${result.prediction}
Confidence Score: ${result.confidence}%
Backend Status: ${result.confidenceLabel}
Recommendation: ${result.recommendation}
Risk Level: ${result.riskLevel}
Quality Status: ${result.qualityStatus}

Quality Metrics:
Sharpness: ${result.qualityMetrics?.sharpness ?? "N/A"}
Brightness: ${result.qualityMetrics?.brightness ?? "N/A"}

System Explanation:
${result.aiExplanation}

Follow-up Recommendation
------------------------
Priority: ${followUp.priority}
Timeframe: ${followUp.timeframe}
Department: ${followUp.department}
Action: ${followUp.action}
Reason: ${followUp.reason}

Clinical Note:
${patientNote || "No clinical note added."}
    `.trim();

    const blob = new Blob([reportText], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = "ocutriage-report.txt";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    URL.revokeObjectURL(url);
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

  const followUpPlan = getFollowUpPlan(result);

  if (page === "analyze") {
    return (
      <div
        style={{
          minHeight: "100vh",
          background:
            "linear-gradient(135deg, #edf4ff 0%, #f8fbff 45%, #eef7ff 100%)",
          fontFamily: "Arial, sans-serif",
          padding: "36px 20px",
          boxSizing: "border-box",
        }}
      >
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
              <span
                style={{
                  width: "10px",
                  height: "10px",
                  borderRadius: "50%",
                  backgroundColor: "#2563eb",
                  display: "inline-block",
                }}
              />
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
                margin: "0 0 34px 0",
                maxWidth: "820px",
              }}
            >
              Upload a retinal fundus image to simulate diabetic retinopathy
              screening. The system analyzes image quality, generates a
              prediction, estimates confidence, and provides heatmap-based AI
              explainability.
            </p>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: isSmallScreen
                  ? "1fr"
                  : "repeat(3, minmax(0, 1fr))",
                gap: "16px",
                marginBottom: "34px",
              }}
            >
              {[
                {
                  num: "01",
                  title: "Upload",
                  text: "Select a retinal fundus image for analysis.",
                },
                {
                  num: "02",
                  title: "Analyze",
                  text: "The backend model evaluates the image and estimates DR risk.",
                },
                {
                  num: "03",
                  title: "Review",
                  text: "View diagnosis, quality metrics, recommendation, and Grad-CAM heatmap.",
                },
              ].map((item) => (
                <div
                  key={item.num}
                  style={{
                    backgroundColor: "#f8fbff",
                    border: "1px solid #dbeafe",
                    borderRadius: "18px",
                    padding: "18px",
                  }}
                >
                  <div
                    style={{
                      width: "42px",
                      height: "42px",
                      borderRadius: "12px",
                      backgroundColor: "#dbeafe",
                      color: "#1d4ed8",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontWeight: "bold",
                      marginBottom: "14px",
                    }}
                  >
                    {item.num}
                  </div>
                  <div
                    style={{
                      fontWeight: "bold",
                      color: "#0f172a",
                      marginBottom: "6px",
                    }}
                  >
                    {item.title}
                  </div>
                  <div
                    style={{
                      color: "#64748b",
                      lineHeight: "1.6",
                      fontSize: "14px",
                    }}
                  >
                    {item.text}
                  </div>
                </div>
              ))}
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

              <div
                style={{
                  marginTop: "24px",
                  display: "flex",
                  gap: "14px",
                  flexWrap: "wrap",
                }}
              >
                <button
                  onClick={handleAnalyze}
                  style={{
                    padding: "14px 28px",
                    fontSize: "16px",
                    fontWeight: "bold",
                    cursor: "pointer",
                    borderRadius: "14px",
                    border: "none",
                    backgroundColor: "#2563eb",
                    color: "white",
                    boxShadow: "0 12px 24px rgba(37, 99, 235, 0.22)",
                  }}
                  disabled={loading}
                >
                  {loading ? "Analyzing..." : "Analyze Image"}
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
                <p
                  style={{
                    marginTop: "18px",
                    color: "#1d4ed8",
                    fontWeight: "bold",
                  }}
                >
                  Analyzing image...
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
                Smart Clinical Support
              </div>

              <h2
                style={{
                  fontSize: isSmallScreen ? "28px" : "34px",
                  lineHeight: "1.2",
                  margin: "0 0 16px 0",
                }}
              >
                Fast retinal screening assistance
              </h2>

              <p
                style={{
                  color: "rgba(255,255,255,0.78)",
                  lineHeight: "1.8",
                  fontSize: "16px",
                  marginBottom: "28px",
                }}
              >
                Upload a retinal image and the system will assess image quality,
                generate a screening result, and return a Grad-CAM heatmap for
                comparison and review.
              </p>
            </div>

            <div style={{ display: "grid", gap: "14px" }}>
              <div
                style={{
                  backgroundColor: "rgba(255,255,255,0.08)",
                  borderRadius: "18px",
                  padding: "18px",
                }}
              >
                <div
                  style={{
                    fontSize: "13px",
                    opacity: 0.7,
                    marginBottom: "8px",
                  }}
                >
                  STEP 1
                </div>
                <div style={{ fontSize: "22px", fontWeight: "bold" }}>
                  Upload retinal image
                </div>
              </div>

              <div
                style={{
                  backgroundColor: "rgba(255,255,255,0.08)",
                  borderRadius: "18px",
                  padding: "18px",
                }}
              >
                <div
                  style={{
                    fontSize: "13px",
                    opacity: 0.7,
                    marginBottom: "8px",
                  }}
                >
                  STEP 2
                </div>
                <div style={{ fontSize: "22px", fontWeight: "bold" }}>
                  Automatic quality check
                </div>
              </div>

              <div
                style={{
                  backgroundColor: "rgba(255,255,255,0.08)",
                  borderRadius: "18px",
                  padding: "18px",
                }}
              >
                <div
                  style={{
                    fontSize: "13px",
                    opacity: 0.7,
                    marginBottom: "8px",
                  }}
                >
                  STEP 3
                </div>
                <div style={{ fontSize: "22px", fontWeight: "bold" }}>
                  View result and Grad-CAM heatmap
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "linear-gradient(135deg, #edf4ff 0%, #f8fbff 45%, #eef7ff 100%)",
        fontFamily: "Arial, sans-serif",
        padding: "36px 20px",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          maxWidth: "1200px",
          margin: "0 auto",
          display: "grid",
          gap: "24px",
        }}
      >
        <div
          style={{
            backgroundColor: "#ffffff",
            borderRadius: "28px",
            padding: isSmallScreen ? "28px 20px" : "34px",
            boxShadow: "0 18px 40px rgba(15, 23, 42, 0.08)",
            border: "1px solid #e5eefc",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              textAlign: "center",
              gap: "14px",
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
              }}
            >
              <span
                style={{
                  width: "10px",
                  height: "10px",
                  borderRadius: "50%",
                  backgroundColor: "#2563eb",
                  display: "inline-block",
                }}
              />
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

            <p
              style={{
                margin: 0,
                color: "#64748b",
                fontSize: isSmallScreen ? "18px" : "20px",
                lineHeight: "1.8",
                maxWidth: "820px",
              }}
            >
              Review diagnosis, quality metrics, backend status, follow-up plan,
              and the Grad-CAM heatmap.
            </p>

            <div
              style={{
                marginTop: "6px",
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

        <div
          style={{
            display: "grid",
            gridTemplateColumns: isMediumScreen ? "1fr" : "1fr 1fr",
            gap: "24px",
          }}
        >
          <div
            style={{
              backgroundColor: "#ffffff",
              borderRadius: "24px",
              padding: "28px",
              boxShadow: "0 18px 40px rgba(15, 23, 42, 0.08)",
              border: "1px solid #e5eefc",
            }}
          >
            <h3
              style={{
                marginTop: 0,
                marginBottom: "18px",
                color: "#0f172a",
                fontSize: "24px",
              }}
            >
              Uploaded Image
            </h3>

            {preview && (
              <img
                src={preview}
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

          <div
            style={{
              backgroundColor: "#ffffff",
              borderRadius: "24px",
              padding: "28px",
              boxShadow: "0 18px 40px rgba(15, 23, 42, 0.08)",
              border: "1px solid #e5eefc",
              display: "grid",
              gridTemplateRows: "auto auto",
              gap: "20px",
            }}
          >
            <div>
              <h3
                style={{
                  marginTop: 0,
                  marginBottom: "20px",
                  color: "#0f172a",
                  fontSize: "24px",
                }}
              >
                Prediction Summary
              </h3>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: isSmallScreen
                    ? "1fr"
                    : "repeat(3, 1fr)",
                  gap: "14px",
                  marginBottom: "24px",
                }}
              >
                <div
                  style={{
                    backgroundColor: "#f8fbff",
                    border: "1px solid #dbeafe",
                    borderRadius: "18px",
                    padding: "18px",
                  }}
                >
                  <div
                    style={{
                      fontSize: "13px",
                      color: "#64748b",
                      marginBottom: "10px",
                    }}
                  >
                    Diagnosis
                  </div>
                  <div
                    style={{
                      fontSize: "20px",
                      fontWeight: "bold",
                      color: getPredictionColor(result?.prediction),
                    }}
                  >
                    {result?.prediction}
                  </div>
                </div>

                <div
                  style={{
                    backgroundColor: "#f8fbff",
                    border: "1px solid #dbeafe",
                    borderRadius: "18px",
                    padding: "18px",
                  }}
                >
                  <div
                    style={{
                      fontSize: "13px",
                      color: "#64748b",
                      marginBottom: "10px",
                    }}
                  >
                    Confidence Score
                  </div>
                  <div
                    style={{
                      fontSize: "24px",
                      fontWeight: "bold",
                      color: getConfidenceColor(result?.confidence || 0),
                    }}
                  >
                    {result?.confidence}%
                  </div>
                </div>

                <div
                  style={{
                    backgroundColor: "#f8fbff",
                    border: "1px solid #dbeafe",
                    borderRadius: "18px",
                    padding: "18px",
                  }}
                >
                  <div
                    style={{
                      fontSize: "13px",
                      color: "#64748b",
                      marginBottom: "10px",
                    }}
                  >
                    Recommendation
                  </div>
                  <div
                    style={{
                      fontSize: "16px",
                      fontWeight: "bold",
                      color: "#0f172a",
                    }}
                  >
                    {result?.recommendation}
                  </div>
                </div>
              </div>

              <div
                style={{
                  backgroundColor: "#f8fafc",
                  border: "1px solid #e2e8f0",
                  borderRadius: "18px",
                  padding: "18px",
                  marginBottom: "20px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: "12px",
                  }}
                >
                  <strong style={{ color: "#0f172a" }}>Confidence Score</strong>
                  <span
                    style={{
                      color: getConfidenceColor(result?.confidence || 0),
                      fontWeight: "bold",
                    }}
                  >
                    {result?.confidence}%
                  </span>
                </div>

                <div
                  style={{
                    width: "100%",
                    height: "14px",
                    backgroundColor: "#e2e8f0",
                    borderRadius: "999px",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${result?.confidence || 0}%`,
                      height: "100%",
                      background: "linear-gradient(90deg, #2563eb, #38bdf8)",
                      borderRadius: "999px",
                    }}
                  />
                </div>

                <div
                  style={{
                    marginTop: "12px",
                    fontSize: "14px",
                    color: "#64748b",
                  }}
                >
                  Backend status: {result?.confidenceLabel}
                </div>
              </div>

              {result?.qualityMetrics && (
                <div
                  style={{
                    backgroundColor: "#f8fbff",
                    border: "1px solid #dbeafe",
                    borderRadius: "18px",
                    padding: "18px",
                  }}
                >
                  <div
                    style={{
                      fontWeight: "bold",
                      color: "#0f172a",
                      marginBottom: "10px",
                    }}
                  >
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

            <div
              style={{
                backgroundColor: "#0f172a",
                borderRadius: "20px",
                padding: "22px",
                color: "white",
              }}
            >
              <div
                style={{
                  fontSize: "13px",
                  letterSpacing: "1px",
                  opacity: 0.7,
                  marginBottom: "10px",
                }}
              >
                SYSTEM EXPLANATION
              </div>
              <p
                style={{
                  margin: 0,
                  lineHeight: "1.8",
                  color: "rgba(255,255,255,0.86)",
                  fontSize: "15px",
                }}
              >
                {result?.aiExplanation}
              </p>
            </div>
          </div>
        </div>

        <div
          style={{
            backgroundColor: "#ffffff",
            borderRadius: "24px",
            padding: isSmallScreen ? "24px 20px" : "28px",
            boxShadow: "0 18px 40px rgba(15, 23, 42, 0.08)",
            border: "1px solid #e5eefc",
          }}
        >
          <div
            style={{
              textAlign: "center",
              maxWidth: "900px",
              margin: "0 auto 24px auto",
            }}
          >
            <h3
              style={{
                marginTop: 0,
                marginBottom: "12px",
                color: "#0f172a",
                fontSize: isSmallScreen ? "34px" : "48px",
                lineHeight: "1.1",
              }}
            >
              Grad-CAM Heatmap
            </h3>

            <p
              style={{
                color: "#64748b",
                lineHeight: "1.8",
                margin: 0,
                fontSize: isSmallScreen ? "18px" : "20px",
              }}
            >
              This heatmap highlights the regions of the retina that most
              influenced the model’s prediction. Warmer colors indicate areas of
              higher importance, helping visualize how the AI makes decisions.
            </p>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: isMediumScreen ? "1fr" : "1fr 1fr",
              gap: "20px",
            }}
          >
            <div
              style={{
                backgroundColor: "#f8fbff",
                border: "1px solid #dbeafe",
                borderRadius: "20px",
                padding: "18px",
              }}
            >
              <div
                style={{
                  fontWeight: "bold",
                  color: "#0f172a",
                  marginBottom: "12px",
                }}
              >
                Original Image
              </div>
              {preview && (
                <img
                  src={preview}
                  alt="Original retina"
                  style={{
                    width: "100%",
                    borderRadius: "16px",
                    border: "1px solid #dbeafe",
                    display: "block",
                    maxHeight: "340px",
                    objectFit: "cover",
                  }}
                />
              )}
            </div>

            <div
              style={{
                backgroundColor: "#f8fbff",
                border: "1px solid #dbeafe",
                borderRadius: "20px",
                padding: "18px",
              }}
            >
              <div
                style={{
                  fontWeight: "bold",
                  color: "#0f172a",
                  marginBottom: "12px",
                }}
              >
                Grad-CAM Heatmap
              </div>

              {result?.heatmap ? (
                <img
                  src={result.heatmap}
                  alt="Grad-CAM heatmap"
                  style={{
                    width: "100%",
                    borderRadius: "16px",
                    border: "1px solid #dbeafe",
                    display: "block",
                    maxHeight: "340px",
                    objectFit: "cover",
                  }}
                />
              ) : (
                <div
                  style={{
                    minHeight: "340px",
                    borderRadius: "16px",
                    border: "1px dashed #cbd5e1",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#64748b",
                  }}
                >
                  Grad-CAM heatmap will appear here after backend analysis
                </div>
              )}
            </div>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: isMediumScreen ? "1fr" : "1fr 0.9fr",
            gap: "24px",
          }}
        >
          <div
            style={{
              backgroundColor: "#ffffff",
              borderRadius: "24px",
              padding: "28px",
              boxShadow: "0 18px 40px rgba(15, 23, 42, 0.08)",
              border: "1px solid #e5eefc",
            }}
          >
            <h3
              style={{
                marginTop: 0,
                marginBottom: "16px",
                color: "#0f172a",
                fontSize: "24px",
              }}
            >
              Clinical Note
            </h3>

            <textarea
              value={patientNote}
              onChange={(e) => setPatientNote(e.target.value)}
              placeholder="Add a short note about the case..."
              style={{
                width: "100%",
                minHeight: "140px",
                padding: "16px",
                borderRadius: "16px",
                border: "1px solid #cbd5e1",
                resize: "vertical",
                fontFamily: "Arial, sans-serif",
                fontSize: "15px",
                boxSizing: "border-box",
                outline: "none",
              }}
            />
          </div>

          <div
            style={{
              backgroundColor: "#ffffff",
              borderRadius: "24px",
              padding: "28px",
              boxShadow: "0 18px 40px rgba(15, 23, 42, 0.08)",
              border: "1px solid #e5eefc",
            }}
          >
            <h3
              style={{
                marginTop: 0,
                marginBottom: "16px",
                color: "#0f172a",
                fontSize: "24px",
              }}
            >
              Actions
            </h3>

            <div style={{ display: "grid", gap: "12px" }}>
              <button
                style={{
                  padding: "14px 18px",
                  borderRadius: "14px",
                  border: "none",
                  backgroundColor: "#2563eb",
                  color: "#ffffff",
                  fontWeight: "bold",
                  fontSize: "15px",
                  cursor: "pointer",
                  boxShadow: "0 10px 20px rgba(37, 99, 235, 0.18)",
                }}
                onClick={handleExportReport}
              >
                Export Report
              </button>

              <button
                style={{
                  padding: "14px 18px",
                  borderRadius: "14px",
                  border: "1px solid #cbd5e1",
                  backgroundColor: "#ffffff",
                  color: "#0f172a",
                  fontWeight: "bold",
                  fontSize: "15px",
                  cursor: "pointer",
                }}
                onClick={() => setShowFollowUp((prev) => !prev)}
              >
                {showFollowUp ? "Hide Follow-up Plan" : "Schedule Follow-up"}
              </button>

              <button
                onClick={handleBack}
                style={{
                  padding: "14px 18px",
                  borderRadius: "14px",
                  border: "1px solid #cbd5e1",
                  backgroundColor: "#f8fafc",
                  color: "#0f172a",
                  fontWeight: "bold",
                  fontSize: "15px",
                  cursor: "pointer",
                }}
              >
                Back to Analyze
              </button>

              <button
                onClick={handleReset}
                style={{
                  padding: "14px 18px",
                  borderRadius: "14px",
                  border: "none",
                  backgroundColor: "#0f172a",
                  color: "white",
                  fontWeight: "bold",
                  fontSize: "15px",
                  cursor: "pointer",
                }}
              >
                Reset Case
              </button>
            </div>
          </div>
        </div>

        {showFollowUp && (
          <div
            style={{
              backgroundColor: "#ffffff",
              borderRadius: "24px",
              padding: "28px",
              boxShadow: "0 18px 40px rgba(15, 23, 42, 0.08)",
              border: "1px solid #e5eefc",
            }}
          >
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
                <h3
                  style={{
                    margin: "0 0 8px 0",
                    color: "#0f172a",
                    fontSize: "28px",
                  }}
                >
                  Follow-up Recommendation
                </h3>
                <p
                  style={{
                    margin: 0,
                    color: "#64748b",
                    lineHeight: "1.7",
                    fontSize: "16px",
                  }}
                >
                  Suggested next step based on the current diagnosis and risk
                  level.
                </p>
              </div>

              <div
                style={{
                  padding: "10px 16px",
                  borderRadius: "999px",
                  fontWeight: "bold",
                  fontSize: "14px",
                  ...followUpPlan.color,
                }}
              >
                {followUpPlan.priority} Priority
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: isMediumScreen ? "1fr" : "repeat(4, 1fr)",
                gap: "14px",
                marginBottom: "20px",
              }}
            >
              <div
                style={{
                  backgroundColor: "#f8fbff",
                  border: "1px solid #dbeafe",
                  borderRadius: "18px",
                  padding: "18px",
                }}
              >
                <div
                  style={{
                    fontSize: "13px",
                    color: "#64748b",
                    marginBottom: "10px",
                  }}
                >
                  Priority
                </div>
                <div
                  style={{
                    fontWeight: "bold",
                    color: followUpPlan.color.color,
                  }}
                >
                  {followUpPlan.priority}
                </div>
              </div>

              <div
                style={{
                  backgroundColor: "#f8fbff",
                  border: "1px solid #dbeafe",
                  borderRadius: "18px",
                  padding: "18px",
                }}
              >
                <div
                  style={{
                    fontSize: "13px",
                    color: "#64748b",
                    marginBottom: "10px",
                  }}
                >
                  Timeframe
                </div>
                <div style={{ fontWeight: "bold", color: "#0f172a" }}>
                  {followUpPlan.timeframe}
                </div>
              </div>

              <div
                style={{
                  backgroundColor: "#f8fbff",
                  border: "1px solid #dbeafe",
                  borderRadius: "18px",
                  padding: "18px",
                }}
              >
                <div
                  style={{
                    fontSize: "13px",
                    color: "#64748b",
                    marginBottom: "10px",
                  }}
                >
                  Department
                </div>
                <div style={{ fontWeight: "bold", color: "#0f172a" }}>
                  {followUpPlan.department}
                </div>
              </div>

              <div
                style={{
                  backgroundColor: "#f8fbff",
                  border: "1px solid #dbeafe",
                  borderRadius: "18px",
                  padding: "18px",
                }}
              >
                <div
                  style={{
                    fontSize: "13px",
                    color: "#64748b",
                    marginBottom: "10px",
                  }}
                >
                  Action
                </div>
                <div style={{ fontWeight: "bold", color: "#0f172a" }}>
                  {followUpPlan.action}
                </div>
              </div>
            </div>

            <div
              style={{
                padding: "18px 20px",
                borderRadius: "18px",
                ...followUpPlan.color,
              }}
            >
              <strong style={{ display: "block", marginBottom: "8px" }}>
                Reason
              </strong>
              <span>{followUpPlan.reason}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;