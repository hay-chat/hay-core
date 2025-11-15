# Email Design System

This document outlines the global styles and variables available for email templates using MJML.

## Color Palette

All colors are defined in `base.mjml` and should be used consistently across all email templates.

### Brand Colors

| Color Name | Hex Code  | Usage                           | MJML Class                    |
| ---------- | --------- | ------------------------------- | ----------------------------- |
| Primary    | `#001bf4` | Primary actions, links          | `text-primary`, `btn-primary` |
| Success    | `#28a745` | Success messages, confirmations | `text-success`, `btn-success` |
| Warning    | `#ffc107` | Warnings, caution messages      | `text-warning`, `btn-warning` |
| Danger     | `#dc3545` | Errors, security alerts         | `text-danger`, `btn-danger`   |
| Info       | `#17a2b8` | Informational messages          | `text-info`, `btn-info`       |

### Text Colors

| Color Name | Hex Code  | Usage                        |
| ---------- | --------- | ---------------------------- |
| Heading    | `#1a1a1a` | Headings (h1, h2, h3)        |
| Body Text  | `#555555` | Main body text               |
| Muted      | `#888888` | Secondary text, footer links |
| Light      | `#999999` | Copyright, very subtle text  |

### Background Colors

| Color Name | Hex Code  | Usage                 | MJML Class      |
| ---------- | --------- | --------------------- | --------------- |
| White      | `#ffffff` | Main content sections | `section-white` |
| Light Gray | `#f9f9f9` | Alternate sections    | `section-gray`  |
| Background | `#f4f4f4` | Page background       | `section-light` |

### Border Colors

| Color Name | Hex Code  | Usage              |
| ---------- | --------- | ------------------ |
| Default    | `#e0e0e0` | Standard dividers  |
| Light      | `#f0f0f0` | Subtle dividers    |
| Dark       | `#cccccc` | Prominent dividers |

## Typography

### Headings

Use MJML classes for consistent heading styles:

```xml
<mj-text mj-class="h1">Main Heading</mj-text>
<mj-text mj-class="h2">Section Heading</mj-text>
<mj-text mj-class="h3">Subsection Heading</mj-text>
```

| Class | Size | Weight | Color   | Line Height |
| ----- | ---- | ------ | ------- | ----------- |
| `h1`  | 24px | 700    | #1a1a1a | 32px        |
| `h2`  | 20px | 600    | #1a1a1a | 28px        |
| `h3`  | 16px | 600    | #1a1a1a | 24px        |

### Text Variants

```xml
<mj-text mj-class="text-body">Body text</mj-text>
<mj-text mj-class="text-small">Small text</mj-text>
<mj-text mj-class="text-muted">Muted text</mj-text>
<mj-text mj-class="text-bold">Bold text</mj-text>
```

| Class        | Size | Color   | Usage                |
| ------------ | ---- | ------- | -------------------- |
| `text-body`  | 14px | #555555 | Regular body text    |
| `text-small` | 12px | #666666 | Small text, captions |
| `text-muted` | 12px | #888888 | Less important text  |
| `text-bold`  | -    | -       | Bold emphasis        |

## Buttons

### Button Variants

```xml
<mj-button mj-class="btn-primary" href="...">Primary Action</mj-button>
<mj-button mj-class="btn-success" href="...">Success Action</mj-button>
<mj-button mj-class="btn-danger" href="...">Danger Action</mj-button>
<mj-button mj-class="btn-warning" href="...">Warning Action</mj-button>
<mj-button mj-class="btn-info" href="...">Info Action</mj-button>
<mj-button mj-class="btn-outline" href="...">Outline Action</mj-button>
```

All buttons have:

- Font size: 14px
- Font weight: 600
- Border radius: 6px
- Padding: 12px 24px

## Sections

### Section Backgrounds

```xml
<mj-section mj-class="section-white">White background</mj-section>
<mj-section mj-class="section-gray">Light gray background</mj-section>
<mj-section mj-class="section-light">Very light background</mj-section>
```

Default padding: 20px 25px

## Dividers

```xml
<mj-divider />  <!-- Default gray -->
<mj-divider mj-class="divider-light" />  <!-- Lighter -->
<mj-divider mj-class="divider-dark" />  <!-- Darker -->
```

## Links

### CSS Classes for Links

```html
<a href="..." class="link-primary">Primary link</a>
<a href="..." class="link-nostyle">Unstyled link</a>
<a href="..." class="footer-link">Footer link</a>
<a href="..." class="word-break">Long URL that needs breaking</a>
```

## Usage Examples

### Security Alert Section

```xml
<mj-section mj-class="section-white">
  <mj-column>
    <mj-text mj-class="text-danger" font-size="13px">
      ⚠️ <strong>Security Alert:</strong> Your password was changed.
    </mj-text>
  </mj-column>
</mj-section>
```

### Success Message

```xml
<mj-section mj-class="section-white">
  <mj-column>
    <mj-text mj-class="text-success" font-size="14px">
      ✓ Your changes have been saved successfully.
    </mj-text>
  </mj-column>
</mj-section>
```

### Call-to-Action with Button

```xml
<mj-section mj-class="section-white">
  <mj-column>
    <mj-text mj-class="text-body">
      Click the button below to verify your email:
    </mj-text>
    <mj-button mj-class="btn-primary" href="{{verificationUrl}}">
      Verify Email
    </mj-button>
  </mj-column>
</mj-section>
```

### Information Card

```xml
<mj-section mj-class="section-gray">
  <mj-column>
    <mj-text mj-class="h3" padding="0 0 10px 0">
      Security Details
    </mj-text>
    <mj-text mj-class="text-small">
      <strong>Time:</strong> {{requestTime}}<br/>
      <strong>IP:</strong> {{ipAddress}}
    </mj-text>
  </mj-column>
</mj-section>
```

## Best Practices

1. **Always use MJML classes** instead of hardcoding colors
2. **Maintain contrast** - ensure text is readable on backgrounds
3. **Use semantic colors** - danger for errors, success for confirmations
4. **Keep it simple** - don't mix too many colors in one email
5. **Test responsiveness** - MJML handles this, but always verify
6. **Consistent spacing** - use padding consistently across sections

## Updating the Design System

To update colors or styles globally:

1. Edit `server/templates/email/base.mjml`
2. Update the `<mj-attributes>` section
3. All templates using MJML classes will automatically inherit changes
4. Update this documentation to reflect changes
