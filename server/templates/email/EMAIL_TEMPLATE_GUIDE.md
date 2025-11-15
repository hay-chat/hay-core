# Email Template Best Practices Guide

This guide provides best practices and standards for creating new email templates in the Hay platform.

## Table of Contents

1. [Template Formats](#template-formats)
2. [MJML Templates (Recommended)](#mjml-templates-recommended)
3. [Legacy HTML Templates](#legacy-html-templates)
4. [Template Registration](#template-registration)
5. [Variables and Substitution](#variables-and-substitution)
6. [Styling Guidelines](#styling-guidelines)
7. [Testing](#testing)
8. [Common Patterns](#common-patterns)

---

## Template Formats

The platform supports two template formats:

1. **MJML Templates** (`.mjml`) - **RECOMMENDED** ✅
   - Modern, responsive email framework
   - Automatically wraps content in base template
   - Handles cross-client compatibility
   - Mobile-responsive by default

2. **Legacy HTML Templates** (`.template.html`)
   - Direct HTML with mustache variables
   - Used for password reset and older templates
   - Being phased out in favor of MJML

---

## MJML Templates (Recommended)

### File Structure

MJML templates should be placed in: `server/templates/email/content/`

**Naming Convention**: `{category}-{action}.mjml`

Examples:
- `privacy-export-request.mjml`
- `privacy-deletion-complete.mjml`
- `onboarding-welcome.mjml`

### Template Structure

**❌ INCORRECT** - Do NOT include full MJML document wrapper:

```mjml
<mjml>
  <mj-head>
    <mj-title>My Email</mj-title>
    ...
  </mj-head>
  <mj-body>
    <mj-section>
      ...
    </mj-section>
  </mj-body>
</mjml>
```

**✅ CORRECT** - Only include content sections:

```mjml
<!-- subject: Email Subject Line with {{variables}} -->
<mj-section background-color="#ffffff" padding-bottom="20px" padding-top="20px">
  <mj-column width="100%">
    <mj-text align="center" color="#333333" font-size="24px" font-weight="bold">
      Email Title
    </mj-text>
  </mj-column>
</mj-section>

<mj-section background-color="#ffffff" padding-bottom="20px" padding-top="0px">
  <mj-column width="100%">
    <mj-text color="#555555" font-size="16px" line-height="24px">
      Email body content goes here with {{variables}}.
    </mj-text>

    <mj-button background-color="#0066ff" color="#ffffff" href="{{actionUrl}}">
      Call to Action
    </mj-button>
  </mj-column>
</mj-section>
```

### Key Requirements

1. **Subject Line**: First line must be HTML comment with subject
   ```mjml
   <!-- subject: Your Subject Here with {{variables}} -->
   ```

2. **Content Only**: Only `<mj-section>` and `<mj-column>` elements
   - DO NOT include `<mjml>`, `<mj-head>`, or `<mj-body>` tags
   - These are provided by `base.mjml` automatically

3. **No Footer**: Do NOT add footer sections
   - Footer is automatically added by `base.mjml`
   - Includes recipient email, copyright, and company info

4. **Padding**: Last section should have bottom padding
   ```mjml
   <mj-text padding-bottom="20px">
     Last paragraph
   </mj-text>
   ```

### Available Design System

The `base.mjml` provides pre-defined styles:

#### Text Classes
```mjml
<mj-text mj-class="h1">Heading 1</mj-text>
<mj-text mj-class="h2">Heading 2</mj-text>
<mj-text mj-class="h3">Heading 3</mj-text>
<mj-text mj-class="text-body">Body text</mj-text>
<mj-text mj-class="text-small">Small text</mj-text>
<mj-text mj-class="text-muted">Muted text</mj-text>
```

#### Brand Colors
```mjml
<mj-text mj-class="text-primary">Blue text</mj-text>
<mj-text mj-class="text-success">Green text</mj-text>
<mj-text mj-class="text-warning">Yellow text</mj-text>
<mj-text mj-class="text-danger">Red text</mj-text>
<mj-text mj-class="text-info">Cyan text</mj-text>
```

#### Button Variants
```mjml
<mj-button mj-class="btn-primary">Primary Action</mj-button>
<mj-button mj-class="btn-success">Success Action</mj-button>
<mj-button mj-class="btn-danger">Delete Action</mj-button>
<mj-button mj-class="btn-warning">Warning Action</mj-button>
<mj-button mj-class="btn-outline">Outline Button</mj-button>
```

#### Section Backgrounds
```mjml
<mj-section mj-class="section-white">...</mj-section>
<mj-section mj-class="section-gray">...</mj-section>
<mj-section mj-class="section-light">...</mj-section>
```

#### Dividers
```mjml
<mj-divider border-color="#e0e0e0" border-width="1px" />
<mj-divider mj-class="divider-light" />
<mj-divider mj-class="divider-dark" />
```

---

## Legacy HTML Templates

For password reset and other legacy templates:

### File Structure

- HTML: `server/templates/email/{template-name}.template.html`
- Text: `server/templates/email/{template-name}.template.txt` (optional)

### Structure

```html
<!-- subject: Email Subject -->
<div style="margin-bottom: 30px;">
    <h2 style="color: #667eea;">Title</h2>
    <p>Content with {{variables}}</p>
</div>

<div style="text-align: center; margin: 40px 0;">
    <a href="{{actionUrl}}" class="button">Call to Action</a>
</div>
```

---

## Template Registration

All templates must be registered in `server/templates/email/templates.json`:

```json
{
  "templates": [
    {
      "id": "privacy-export-request",
      "name": "Privacy - Data Export Request",
      "description": "GDPR data export verification email",
      "category": "privacy",
      "variables": [
        "userName",
        "verificationUrl",
        "expiresIn",
        "supportUrl",
        "companyName"
      ]
    }
  ]
}
```

### Required Fields

- **id**: Unique identifier (matches filename without extension)
- **name**: Human-readable name
- **description**: Brief description of purpose
- **category**: Grouping category (privacy, onboarding, security, etc.)
- **variables**: Array of all template variables

---

## Variables and Substitution

### Standard Variables

These are **automatically injected** by the email service:

```
{{logoUrl}}          - Company logo URL
{{websiteUrl}}       - Dashboard/website URL
{{currentYear}}      - Current year (e.g., "2025")
{{recipientEmail}}   - Email recipient (added by base.mjml footer)
```

### Custom Variables

Define custom variables in your service code:

```typescript
await emailService.sendTemplateEmail({
  to: 'user@example.com',
  template: 'privacy-export-request',
  variables: {
    userName: 'John Doe',
    verificationUrl: 'https://...',
    expiresIn: '24 hours',
    supportUrl: 'https://support.example.com',
    companyName: 'Hay',
  },
});
```

### Variable Syntax

Use double curly braces: `{{variableName}}`

```mjml
<mj-text>
  Hi {{userName}}, your link expires in {{expiresIn}}.
</mj-text>
```

Variables work in:
- Text content
- URLs (`href` attributes)
- Subjects (in HTML comment)
- All template types (MJML and HTML)

---

## Styling Guidelines

### Typography

- **Headings**:
  - H1: 24px, bold, #1a1a1a
  - H2: 20px, semi-bold, #1a1a1a
  - H3: 16px, semi-bold, #1a1a1a

- **Body Text**: 14-16px, #555555, line-height: 20-24px

- **Muted Text**: 12-14px, #888888

### Colors

- **Primary**: #001df5 (Blue)
- **Success**: #28a745 (Green)
- **Warning**: #ffc107 (Yellow)
- **Danger**: #dc3545 (Red)
- **Info**: #17a2b8 (Cyan)

### Spacing

- **Section Padding**: 20-25px
- **Text Padding**: 10-20px between elements
- **Button Padding**: 12px 24px

### Buttons

```mjml
<!-- Primary action -->
<mj-button background-color="#0066ff" color="#ffffff" href="{{actionUrl}}">
  Primary Action
</mj-button>

<!-- Destructive action -->
<mj-button background-color="#d32f2f" color="#ffffff" href="{{deleteUrl}}">
  Delete Action
</mj-button>
```

Always provide both button and text link:

```mjml
<mj-button href="{{actionUrl}}">Click Here</mj-button>

<mj-text font-size="14px" padding-top="10px">
  Or copy and paste this link into your browser:
</mj-text>

<mj-text font-size="12px" color="#0066ff">
  {{actionUrl}}
</mj-text>
```

---

## Testing

### 1. Local Development

Test emails with SMTP disabled (logs to console):

```typescript
// In server/.env
SMTP_ENABLED=false
```

### 2. Test Script

Use the test email script:

```bash
cd server
npm run test-email
```

### 3. Email Clients

Test in multiple email clients:
- Gmail (web, mobile)
- Outlook (desktop, web)
- Apple Mail
- Mobile devices (iOS, Android)

### 4. MJML Validation

MJML templates are validated during compilation. Check for:
- Valid MJML syntax
- No compilation errors in logs
- Proper variable substitution

---

## Common Patterns

### 1. Verification Email

```mjml
<!-- subject: Verify Your {{actionType}} Request -->
<mj-section background-color="#ffffff" padding="20px">
  <mj-column>
    <mj-text align="center" font-size="24px" font-weight="bold">
      Verify Your Request
    </mj-text>

    <mj-text font-size="16px">
      Hi {{userName}}, we received a request to {{actionType}}.
      Please verify this action.
    </mj-text>

    <mj-button background-color="#0066ff" href="{{verificationUrl}}">
      Verify Request
    </mj-button>

    <mj-text font-size="14px" padding-top="10px">
      Link expires in {{expiresIn}}
    </mj-text>
  </mj-column>
</mj-section>
```

### 2. Confirmation Email

```mjml
<!-- subject: {{action}} Completed -->
<mj-section background-color="#ffffff" padding="20px">
  <mj-column>
    <mj-text align="center" font-size="24px" font-weight="bold">
      ✓ {{action}} Completed
    </mj-text>

    <mj-text font-size="16px">
      This confirms that {{action}} has been completed successfully.
    </mj-text>

    <mj-divider border-color="#e0e0e0" />

    <mj-text font-size="14px">
      <strong>What happened:</strong><br/>
      • Action 1<br/>
      • Action 2<br/>
      • Action 3
    </mj-text>
  </mj-column>
</mj-section>
```

### 3. Alert/Warning Email

```mjml
<!-- subject: ⚠️ Important: {{warningSubject}} -->
<mj-section background-color="#ffffff" padding="20px">
  <mj-column>
    <mj-text align="center" font-size="24px" font-weight="bold" color="#d32f2f">
      ⚠️ {{warningTitle}}
    </mj-text>

    <mj-text font-size="16px" color="#d32f2f" font-weight="bold">
      WARNING: {{warningMessage}}
    </mj-text>

    <mj-text font-size="14px">
      {{detailedExplanation}}
    </mj-text>

    <mj-button background-color="#d32f2f" href="{{actionUrl}}">
      Take Action
    </mj-button>
  </mj-column>
</mj-section>
```

---

## Checklist for New Templates

- [ ] Template file created in `content/` directory
- [ ] Filename follows convention: `{category}-{action}.mjml`
- [ ] Subject line included as first HTML comment
- [ ] Only content sections (no `<mjml>` wrapper)
- [ ] No custom footer (handled by base.mjml)
- [ ] Last section has bottom padding
- [ ] Registered in `templates.json`
- [ ] All variables documented in `templates.json`
- [ ] Uses design system colors/styles
- [ ] Includes both button and text link for actions
- [ ] Mobile responsive (MJML handles this)
- [ ] Tested with SMTP disabled (console logs)
- [ ] Tested in multiple email clients
- [ ] Variables properly substituted

---

## Examples

See these templates for reference:

- **MJML (Modern)**:
  - `content/privacy-export-request.mjml`
  - `content/privacy-deletion-complete.mjml`

- **HTML (Legacy)**:
  - `reset-password.template.html`

---

## Troubleshooting

### Email body is empty

**Cause**: MJML template includes full `<mjml>` wrapper instead of just content sections.

**Fix**: Remove `<mjml>`, `<mj-head>`, and `<mj-body>` tags. Keep only `<mj-section>` elements.

### Variables not substituting

**Cause**: Variable name mismatch between template and service code.

**Fix**: Ensure variable names match exactly (case-sensitive).

### Styling looks broken in some clients

**Cause**: Using unsupported CSS or HTML elements.

**Fix**: Stick to MJML components and design system classes.

### Template not found error

**Cause**: Template not registered in `templates.json`.

**Fix**: Add template entry to `templates.json` and restart server.

---

## Additional Resources

- [MJML Documentation](https://mjml.io/documentation/)
- [Email Client Support](https://www.caniemail.com/)
- [Base Template](base.mjml)
- [Templates Registry](templates.json)

---

**Last Updated**: January 2025
**Maintainer**: Development Team
