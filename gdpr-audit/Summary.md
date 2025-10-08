# GDPR Audit Summary: Hay Core Platform

**Audit Date:** 2025-10-08
**Repository:** hay-core
**Overall Risk Level:** **HIGH**
**Auditor:** Claude (Anthropic)
**Scope:** Full-stack TypeScript application (Nuxt 3 dashboard, Express/tRPC API, PostgreSQL/pgvector, OpenAI integration)

---

## Executive Summary

A comprehensive GDPR compliance audit of the Hay customer support platform identified **13 distinct findings** across critical compliance domains. The platform demonstrates strong **multi-tenant isolation** and security fundamentals, but lacks essential data subject rights infrastructure and privacy-by-design mechanisms required by GDPR Articles 12-22, 25, 28, and 32-34.

**Key Strengths:**
- ✅ Robust organization-scoped data access controls (Art.32 security)
- ✅ Webhook signature verification (with improvement needed)
- ✅ JWT-based authentication with configurable secrets
- ✅ No automated decision-making detected (Art.22 compliant)

**Critical Gaps:**
- ❌ **No DSAR endpoints** for data export, erasure, or rectification (Art.15, 17, 20)
- ❌ **No retention policies** for messages, conversations, or embeddings (Art.5(1)(e))
- ❌ **No incident response workflow** for breach notification (Art.33-34)
- ❌ **Incomplete embedding deletion** on conversation/document removal (Art.17)
- ⚠️ **Weak default JWT secrets** expose authentication to brute-force (Art.32)

The platform processes sensitive customer support conversations, including potential special category data (health inquiries, payment info). Without DSAR tooling and retention controls, Hay exposes both itself (as processor) and its tenants (as controllers) to regulatory enforcement risk, including fines up to **€20M or 4% of global turnover** under Art.83.

---

## Risk Distribution

| Severity | Count | Primary GDPR Articles |
|----------|-------|----------------------|
| **Critical** | 1 | Art.15, 17, 20 (DSAR) |
| **High** | 4 | Art.5(e), Art.17, Art.32, Art.33 |
| **Medium** | 5 | Art.28, Art.32, Art.44-50, Art.17 |
| **Low** | 3 | Art.5(c), Art.32, ePrivacy |

**Category Breakdown:**
- DSAR (Data Subject Access Requests): 2 findings
- Security of Processing: 3 findings
- Storage Limitation & Retention: 2 findings
- Processor Duties & Subprocessors: 2 findings
- Incident Response: 1 finding
- International Transfers: 1 finding
- Logging & Minimization: 1 finding
- Cookies/ePrivacy: 1 finding
- Backups: 1 finding

---

## Top 10 Priority Risks

1. **GDPR-001: Missing DSAR Endpoints** (Critical)
   - No API for data export, erasure, or rectification
   - Violates Art.15, 17, 20 – core data subject rights
   - **Impact:** Direct fine risk, inability to respond to DSAR requests
   - **Fix Complexity:** Large (3-4 weeks)

2. **GDPR-002: No Retention Policy** (High)
   - Messages, conversations, embeddings stored indefinitely
   - Violates Art.5(1)(e) storage limitation
   - **Impact:** Unbounded PII accumulation, breach exposure
   - **Fix Complexity:** Medium (2 weeks)

3. **GDPR-003: Weak Default JWT Secrets** (High)
   - Default secrets could be used in production
   - Violates Art.32 security requirements
   - **Impact:** Account compromise, mass data exfiltration
   - **Fix Complexity:** Small (1 day)

4. **GDPR-005: No Incident Response** (High)
   - No breach detection, assessment, or notification workflow
   - Violates Art.33-34 breach notification (72-hour deadline)
   - **Impact:** Failure to notify breaches, compounded fines
   - **Fix Complexity:** Large (3 weeks)

5. **GDPR-007: Embeddings Not Deleted on Erasure** (High)
   - Vector store orphans embeddings when conversation deleted
   - Violates Art.17 right to erasure
   - **Impact:** Incomplete DSAR compliance, data persistence
   - **Fix Complexity:** Medium (1 week)

6. **GDPR-004: Webhook Replay Vulnerability** (Medium)
   - No timestamp validation for non-Stripe webhooks
   - Violates Art.32 security requirements
   - **Impact:** Replay attacks, data integrity issues
   - **Fix Complexity:** Medium (1 week)

7. **GDPR-006: No Data Residency Controls** (Medium)
   - OpenAI, database may process data outside EEA
   - Violates Chapter V transfer requirements
   - **Impact:** Cross-border transfer violations, SCCs required
   - **Fix Complexity:** Medium (2 weeks)

8. **GDPR-008: Undocumented Subprocessors** (Medium)
   - No OpenAI DPA tracking or subprocessor list
   - Violates Art.28 processor duties
   - **Impact:** Tenant compliance gaps, audit failures
   - **Fix Complexity:** Small (2 days)

9. **GDPR-009: Backup Retention** (Medium)
   - Deleted data persists in backups indefinitely
   - Violates Art.17 erasure obligations
   - **Impact:** Incomplete erasure, restore issues
   - **Fix Complexity:** Medium (1 week)

10. **GDPR-011: No OpenAI Training Opt-Out Verification** (Medium)
    - No code ensures training opt-out enforced
    - Violates Art.28 processor obligations
    - **Impact:** Unauthorized further processing
    - **Fix Complexity:** Small (1 day)

---

## Compliance Posture

**Current State:** ⚠️ **Non-Compliant**
- Missing foundational DSAR infrastructure
- No documented retention or deletion policies
- Limited subprocessor transparency

**Target State:** ✅ **Compliant**
- Full DSAR API suite (export, delete, rectify)
- Automated retention with configurable policies
- Documented subprocessors with DPA tracking
- Incident response runbooks and breach notification

**Estimated Remediation Effort:** 8-12 weeks (1-2 engineers)

**Quick Wins (< 1 week):**
- GDPR-003: Enforce strong JWT secrets (1 day)
- GDPR-008: Document subprocessors (2 days)
- GDPR-011: Verify OpenAI training opt-out (1 day)

**High-ROI Fixes:**
- GDPR-001: DSAR endpoints (unlocks Art.15-20 compliance)
- GDPR-002: Retention policies (prevents unbounded liability)
- GDPR-003: JWT secrets (prevents auth bypass)

---

## Regulatory Risk Assessment

**Likelihood of Enforcement Action:** Medium-High
- Hay processes high-volume customer conversations (likely >10,000 data subjects)
- Operates in multi-tenant SaaS model (each tenant = potential complaint source)
- Integrates with regulated industries (e-commerce, healthcare support possible)

**Potential Fine Calculation (Worst Case):**
- Violation of Art.15, 17 (DSAR): Up to €20M or 4% global turnover
- Violation of Art.33 (breach notification): Up to €10M or 2% global turnover
- Aggravating factors: Lack of technical measures (Art.25, 32)

**Mitigating Factors:**
- Strong tenant isolation reduces cross-contamination risk
- No special category data processing detected (unless health support present)
- Proactive audit demonstrates commitment to compliance

**Recommendation:** Prioritize GDPR-001 (DSAR) and GDPR-002 (retention) to establish baseline compliance. Address GDPR-003 (JWT) immediately to prevent security incidents.

---

## Next Steps

1. **Immediate (Week 1):**
   - Fix GDPR-003: Enforce JWT secret validation
   - Document GDPR-008: Create SUBPROCESSORS.md
   - Plan GDPR-001: Design DSAR API architecture

2. **Short-term (Weeks 2-6):**
   - Implement GDPR-001: DSAR endpoints (export, delete)
   - Implement GDPR-002: Retention worker and policies
   - Fix GDPR-007: Cascade embedding deletion

3. **Medium-term (Weeks 7-12):**
   - Implement GDPR-005: Incident response workflow
   - Implement GDPR-006: Data residency controls
   - Fix GDPR-004: Webhook replay protection

4. **Ongoing:**
   - Quarterly GDPR compliance reviews
   - Penetration testing of DSAR endpoints
   - Subprocessor DPA renewals and updates

---

## Conclusion

Hay's core architecture is **privacy-capable** with strong multi-tenancy, but requires **critical GDPR infrastructure** to achieve compliance. The absence of DSAR endpoints and retention policies represents the highest risk. With focused engineering effort (8-12 weeks), Hay can transition from **HIGH** to **LOW** risk and provide tenants with a defensible compliance posture.

**Recommendation:** Treat GDPR-001 (DSAR) and GDPR-002 (retention) as **P0** engineering priorities. These are not feature enhancements but **legal requirements** under EU law. Engage legal counsel to validate remediation plan and prepare DPA templates for tenants.

---

**Report Generated:** 2025-10-08
**Contact:** See Remediation.md for detailed fix plans
**Appendices:** Findings.json, DSAR-Coverage.csv, Subprocessors.csv, SearchEvidence.txt
