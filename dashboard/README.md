# Hay Dashboard

A modern Vue 3 + Nuxt 3 dashboard application with shadcn/ui components for the Hay platform.

## Features

### Authentication System
- **Login Page** (`/login`)
  - Email/password authentication
  - Social login (Google, GitHub, Microsoft)
  - Remember me functionality
  - Password visibility toggle
  - Form validation with error handling

- **Signup Page** (`/signup`)
  - Organization and admin account creation
  - Password strength indicator
  - Terms and privacy policy acceptance
  - Real-time form validation
  - Social signup options

- **Forgot Password** (`/forgot-password`)
  - Email-based password reset
  - Success state with resend functionality
  - Cooldown timer for resend attempts
  - Clear user feedback

### Tech Stack
- **Framework**: Nuxt 3 with Vue 3 Composition API
- **Styling**: Tailwind CSS with shadcn/ui components
- **TypeScript**: Full TypeScript support
- **Form Validation**: Custom validation with VeeValidate integration ready
- **Icons**: Heroicons
- **State Management**: Composables with Pinia ready

## Project Structure

```
src/
├── assets/
│   └── css/
│       └── main.css              # Global styles and Tailwind imports
├── components/
│   ├── ui/                       # shadcn/ui base components
│   │   ├── Button.vue
│   │   ├── Input.vue
│   │   ├── Card.vue
│   │   ├── Label.vue
│   │   ├── Checkbox.vue
│   │   └── Progress.vue
│   └── auth/                     # Authentication-specific components
│       ├── FormField.vue         # Reusable form field with validation
│       ├── PasswordStrength.vue  # Password strength indicator
│       └── SocialButton.vue      # Social login buttons
├── composables/
│   ├── useAuth.ts               # Authentication state management
│   └── useFormValidation.ts     # Form validation utilities
├── layouts/
│   └── auth.vue                 # Authentication layout
├── lib/
│   └── utils.ts                 # Utility functions
├── pages/
│   ├── login.vue                # Login page
│   ├── signup.vue               # Signup page
│   └── forgot-password.vue      # Password reset page
├── app.vue                      # Root application component
├── nuxt.config.ts              # Nuxt configuration
└── tailwind.config.ts          # Tailwind configuration
```

## Setup Instructions

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Development Server**
   ```bash
   npm run dev
   ```

3. **Build for Production**
   ```bash
   npm run build
   ```

4. **Type Checking**
   ```bash
   npm run type-check
   ```

5. **Linting**
   ```bash
   npm run lint
   npm run lint:fix
   ```

## Implementation Status

### ✅ Completed Features
- Project structure setup
- shadcn/ui component integration
- Authentication layout design
- Login page with social auth options
- Signup page with organization setup
- Forgot password flow
- Form validation utilities
- Password strength indicator
- Responsive design
- TypeScript configuration
- ESLint setup

### 🔄 TODO: Backend Integration
All pages currently contain TODO comments for backend integration:

- **Authentication API Integration**
  - Login endpoint integration
  - Signup/registration endpoint
  - Password reset endpoint
  - Social OAuth flows
  - Token management
  - Session handling

- **Form Validation**
  - Server-side validation
  - Email verification
  - Password policy enforcement
  - Rate limiting

- **User Management**
  - User profile management
  - Organization setup
  - Role-based access control
  - Email verification flow

- **Security Features**
  - CSRF protection
  - Secure token storage
  - Session management
  - Two-factor authentication

## Component Usage

### FormField Component
```vue
<FormField
  id="email"
  label="Email address"
  type="email"
  placeholder="Enter your email"
  required
  v-model="form.email"
  :error-message="errors.email"
  @blur="validateField('email')"
/>
```

### Social Authentication
```vue
<SocialButton
  provider="google"
  action="login"
  :loading="loading"
  @click="handleSocialAuth"
/>
```

### Form Validation
```ts
const { errors, validateField, isFormValid } = useFormValidation(form, {
  email: { required: true, email: true },
  password: { required: true, minLength: 8 }
})
```

## Design System

The application uses a consistent design system based on shadcn/ui:

- **Colors**: Primary blue theme with semantic color tokens
- **Typography**: Inter font family with consistent text scales
- **Spacing**: Tailwind spacing scale (4px base unit)
- **Components**: Accessible, composable UI components
- **Dark Mode**: Ready (CSS variables configured)

## Browser Support

- Chrome/Edge 88+
- Firefox 85+
- Safari 14+

## Security Considerations

- Form validation on both client and server
- Secure token storage recommendations
- CSRF protection ready
- Input sanitization
- Rate limiting for auth endpoints
- Social auth security best practices

## Accessibility

- WCAG 2.1 AA compliance ready
- Keyboard navigation support
- Screen reader friendly
- Focus management
- Semantic HTML structure
- ARIA labels and roles

---

**Note**: This is the frontend UI implementation. Backend API integration is required for full functionality. All authentication flows are currently mocked with TODO comments indicating where real API calls should be implemented.