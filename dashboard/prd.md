# Hay Dashboard - Vue Nuxt Application PRD

## Overview

The Hay Dashboard is a Vue 3 + Nuxt 3 application that provides a comprehensive web interface for managing chatbots, organizations, agents, playbooks, and conversations. Built with Vue ShadCN components for a modern, accessible UI, this dashboard serves as the primary control center for the Hay platform.

## Technology Stack

- **Framework**: Nuxt 3 with Vue 3 Composition API
- **UI Components**: Vue ShadCN (shadcn-vue)
- **Styling**: Tailwind CSS
- **State Management**: Pinia
- **Icons**: Lucide Vue
- **Charts**: Chart.js / vue-chartjs
- **Forms**: VeeValidate with Zod schemas
- **Authentication**: JWT with refresh tokens
- **Real-time**: Socket.io client

## Application Structure

### Core Layout Components

#### 1. App Shell (`layouts/default.vue`)
- **Sidebar Navigation**: Collapsible sidebar with main navigation items
- **Top Bar**: User profile, notifications, organization switcher
- **Main Content Area**: Dynamic content with breadcrumbs
- **Mobile Responsive**: Drawer navigation for mobile devices

#### 2. Authentication Layout (`layouts/auth.vue`)
- **Clean minimal layout** for login/signup pages
- **Brand header** with logo
- **Footer** with links to documentation and support

### Page Components

#### 1. Authentication Pages

##### Login Page (`pages/login.vue`)
- Email/password input fields
- Remember me checkbox
- Forgot password link
- Social login buttons (Google, GitHub)
- Sign up link
- Form validation with error messages
- Loading states during authentication
```vue
// TODO: Implement actual authentication logic
// TODO: Connect to auth API endpoint
// TODO: Store JWT tokens securely
// TODO: Handle OAuth providers
```

##### Sign Up Page (`pages/signup.vue`)
- Organization name field
- Admin email and password fields
- Terms acceptance checkbox
- Password strength indicator
- Email verification flow
```vue
// TODO: Implement user registration
// TODO: Create organization on signup
// TODO: Send verification email
// TODO: Handle invitation codes
```

##### Forgot Password Page (`pages/forgot-password.vue`)
- Email input for reset link
- Success message display
- Back to login link
```vue
// TODO: Implement password reset email
// TODO: Handle reset token validation
```

#### 2. Dashboard Pages

##### Overview Dashboard (`pages/index.vue`)
- **Metrics Cards**: Active agents, total conversations, resolution rate, avg response time
- **Activity Chart**: Line chart showing conversation volume over time
- **Recent Conversations**: List of latest customer interactions
- **Agent Performance**: Table showing agent metrics
- **Quick Actions**: Buttons for common tasks (Create Agent, View Reports, etc.)
```vue
// TODO: Fetch dashboard metrics from API
// TODO: Implement real-time metric updates
// TODO: Connect WebSocket for live data
```

##### Organizations Management (`pages/organizations/index.vue`)
- **Organization List**: Card grid or table view of organizations
- **Organization Card**: Name, logo, member count, agent count, status
- **Create Organization Button**: Opens modal for new org creation
- **Search and Filter**: Search by name, filter by status
```vue
// TODO: Implement organization CRUD operations
// TODO: Handle organization switching
// TODO: Manage organization settings
```

##### Organization Detail (`pages/organizations/[id]/index.vue`)
- **Organization Header**: Logo, name, description edit
- **Tab Navigation**: Overview, Members, Settings, Billing
- **Overview Tab**: 
  - Organization metrics
  - Recent activity feed
  - Resource usage charts
- **Members Tab**: 
  - Member list with roles
  - Invite new members form
  - Role management
- **Settings Tab**:
  - General settings (name, logo, timezone)
  - Security settings (SSO, 2FA requirements)
  - API keys management
```vue
// TODO: Implement member invitation system
// TODO: Handle role-based permissions
// TODO: Manage organization API keys
```

#### 3. Agent Management

##### Agents List (`pages/agents/index.vue`)
- **Agent Cards**: Grid view with agent avatar, name, status, metrics
- **Create Agent Button**: Opens agent creation wizard
- **Filter Options**: By status, type, organization
- **Bulk Actions**: Enable/disable multiple agents
```vue
// TODO: Fetch agents from API
// TODO: Implement agent status toggle
// TODO: Handle bulk operations
```

##### Agent Creation Wizard (`pages/agents/new.vue`)
- **Step 1: Basic Information**
  - Agent name and description
  - Avatar/icon selection
  - Language settings
- **Step 2: Knowledge Base**
  - Import from Zendesk
  - Import from website (URL scraping)
  - Upload documents (PDF, DOCX, TXT)
  - Import support tickets
- **Step 3: Personality & Behavior**
  - Tone of voice selection (Professional, Friendly, Casual)
  - Response style configuration
  - Custom instructions textarea
- **Step 4: Review & Create**
  - Summary of configuration
  - Test conversation preview
```vue
// TODO: Implement multi-step form logic
// TODO: Handle file uploads
// TODO: Connect to document import APIs
// TODO: Implement agent personality configuration
```

##### Agent Detail (`pages/agents/[id]/index.vue`)
- **Agent Header**: Avatar, name, status toggle, last active
- **Tab Navigation**: Overview, Playbooks, Conversations, Analytics, Settings
- **Overview Tab**:
  - Key metrics cards
  - Recent conversations list
  - Performance chart
- **Playbooks Tab**: 
  - List of active playbooks
  - Create/edit playbook buttons
  - Playbook performance metrics
```vue
// TODO: Implement real-time agent status
// TODO: Connect to conversation history API
// TODO: Handle playbook management
```

#### 4. Insights & Playbooks

##### Insights Dashboard (`pages/insights/index.vue`)
- **Pending Insights**: Cards showing AI-generated suggestions
- **Insight Card**:
  - Type badge (New Playbook, Improvement, Pattern)
  - Description of insight
  - Affected conversations count
  - Accept/Reject buttons
  - Preview button
- **Filters**: By type, date range, agent
- **Accepted Insights History**: Table of processed insights
```vue
// TODO: Fetch insights from AI analysis
// TODO: Implement accept/reject workflow
// TODO: Track insight performance
```

##### Playbooks Management (`pages/playbooks/index.vue`)
- **Playbook List**: Table with name, trigger, usage count, success rate
- **Create Playbook Button**: Opens playbook editor
- **Search and Filter**: By name, trigger type, status
- **Playbook Categories**: Customer Support, Sales, Technical, Custom
```vue
// TODO: Implement playbook CRUD operations
// TODO: Handle playbook categorization
// TODO: Track playbook metrics
```

##### Playbook Editor (`pages/playbooks/[id]/edit.vue`)
- **Trigger Configuration**:
  - Keywords/phrases
  - Intent detection
  - Condition builder
- **Response Flow**:
  - Visual flow builder
  - Text response nodes
  - Action nodes (API calls, MCP actions)
  - Conditional branches
- **Actions/Integrations**:
  - Available MCP actions list
  - Action parameter configuration
  - Test action button
- **Fallback Configuration**:
  - Default response
  - Escalation to human
  - Create support ticket
```vue
// TODO: Implement visual flow builder
// TODO: Connect to MCP actions API
// TODO: Handle condition logic
// TODO: Implement playbook testing
```

#### 5. Conversations

##### Conversations List (`pages/conversations/index.vue`)
- **Conversation Table**: 
  - Customer name/ID
  - Agent name
  - Status (Active, Resolved, Escalated)
  - Duration
  - Last message preview
  - Satisfaction score
- **Filters**: By status, agent, date range, satisfaction
- **Bulk Actions**: Export, assign, close
```vue
// TODO: Implement conversation pagination
// TODO: Handle real-time updates
// TODO: Connect to export functionality
```

##### Conversation Detail (`pages/conversations/[id].vue`)
- **Split View Layout**:
  - Left: Conversation thread
  - Right: Customer info, context, actions
- **Conversation Thread**:
  - Message bubbles with timestamps
  - System messages (agent joined, escalated, etc.)
  - Playbook execution indicators
  - File attachments
- **Supervision Mode Controls**:
  - Approve/Reject message buttons
  - Edit response before sending
  - Take over conversation button
- **Context Panel**:
  - Customer information
  - Previous conversations
  - Related knowledge base articles
  - Available actions
```vue
// TODO: Implement WebSocket connection for real-time messages
// TODO: Handle supervision mode controls
// TODO: Implement conversation takeover
// TODO: Connect to customer context API
```

#### 6. Integrations

##### Connectors (`pages/integrations/connectors.vue`)
- **Available Connectors**: Grid of connector cards
- **Connector Card**:
  - Platform logo (Slack, Discord, WhatsApp, etc.)
  - Status (Connected/Disconnected)
  - Configuration button
  - Test connection button
- **Web Chat Widget**: 
  - Preview customization
  - Embed code generator
  - Styling options
```vue
// TODO: Implement connector configuration
// TODO: Generate embed codes
// TODO: Handle OAuth flows for platforms
```

##### MCP Actions (`pages/integrations/actions.vue`)
- **Actions Library**: List of available MCP actions
- **Action Card**:
  - Action name and description
  - Required parameters
  - Test action form
  - Usage in playbooks count
- **Create Custom Action**: 
  - Action definition form
  - Parameter configuration
  - Test endpoint
```vue
// TODO: Fetch available MCP actions
// TODO: Implement action testing
// TODO: Handle custom action creation
```

#### 7. Analytics & Reports

##### Analytics Overview (`pages/analytics/index.vue`)
- **Date Range Selector**: Quick ranges and custom date picker
- **KPI Cards**: 
  - Total conversations
  - Resolution rate
  - Average response time
  - Customer satisfaction
- **Charts Section**:
  - Conversation volume over time
  - Resolution rate trend
  - Response time distribution
  - Top issues/topics
- **Export Options**: PDF, CSV, scheduled reports
```vue
// TODO: Implement date range filtering
// TODO: Connect to analytics API
// TODO: Handle report generation
```

##### Custom Reports (`pages/analytics/reports.vue`)
- **Report Builder**:
  - Metric selection
  - Grouping options
  - Filter configuration
  - Visualization type selection
- **Saved Reports**: List of custom reports
- **Schedule Reports**: Email delivery configuration
```vue
// TODO: Implement report builder logic
// TODO: Handle report scheduling
// TODO: Connect to email service
```

#### 8. Settings

##### General Settings (`pages/settings/general.vue`)
- **Platform Settings**:
  - Default language
  - Timezone
  - Date/time format
- **Notification Preferences**:
  - Email notifications
  - In-app notifications
  - Webhook endpoints
```vue
// TODO: Implement settings persistence
// TODO: Handle notification preferences
```

##### Security Settings (`pages/settings/security.vue`)
- **Authentication**:
  - Password requirements
  - Session timeout
  - Two-factor authentication
- **API Security**:
  - API key management
  - Rate limiting configuration
  - IP whitelist
```vue
// TODO: Implement 2FA setup
// TODO: Handle API key generation
// TODO: Manage security policies
```

##### Billing (`pages/settings/billing.vue`)
- **Current Plan**: Plan details and usage
- **Usage Metrics**: Conversations, storage, API calls
- **Payment Method**: Card management
- **Invoices**: Download past invoices
- **Upgrade Plan**: Plan comparison and upgrade flow
```vue
// TODO: Integrate payment processor
// TODO: Handle subscription management
// TODO: Implement usage tracking
```

### Component Library

#### Form Components
- **Input Fields**: Text, email, password with validation states
- **Select Dropdowns**: Single and multi-select with search
- **Checkboxes & Radios**: With labels and descriptions
- **File Upload**: Drag-and-drop with progress
- **Date/Time Pickers**: With range selection
- **Rich Text Editor**: For playbook responses

#### Data Display Components
- **Data Tables**: Sortable, filterable, paginated
- **Cards**: Various layouts for different content types
- **Charts**: Line, bar, pie, donut charts
- **Metrics Cards**: With trend indicators
- **Timeline**: For activity feeds
- **Empty States**: Helpful messages when no data

#### Feedback Components
- **Alerts**: Success, error, warning, info
- **Toasts**: Non-blocking notifications
- **Modals**: Confirmation, forms, information
- **Loading States**: Spinners, skeletons, progress bars
- **Tooltips**: Contextual help text

#### Navigation Components
- **Breadcrumbs**: Hierarchical navigation
- **Tabs**: For section organization
- **Pagination**: Number and cursor-based
- **Sidebar**: Collapsible with sections
- **Command Palette**: Quick navigation (Cmd+K)

### State Management (Pinia Stores)

#### Auth Store (`stores/auth.ts`)
```typescript
// TODO: Implement authentication state
// - User object
// - JWT tokens
// - Login/logout methods
// - Token refresh logic
// - Permission checks
```

#### Organization Store (`stores/organization.ts`)
```typescript
// TODO: Implement organization state
// - Current organization
// - Organization list
// - Switch organization method
// - Organization settings
```

#### Agent Store (`stores/agents.ts`)
```typescript
// TODO: Implement agents state
// - Agents list
// - Current agent
// - CRUD operations
// - Status management
```

#### Conversation Store (`stores/conversations.ts`)
```typescript
// TODO: Implement conversations state
// - Conversations list
// - Active conversation
// - Real-time message handling
// - Supervision mode state
```

#### UI Store (`stores/ui.ts`)
```typescript
// TODO: Implement UI state
// - Sidebar collapsed state
// - Theme (light/dark)
// - Notification queue
// - Modal states
// - Loading states
```

### API Integration

#### API Client (`utils/api.ts`)
```typescript
// TODO: Implement API client with:
// - Axios instance with interceptors
// - Request/response error handling
// - Token refresh logic
// - Request retry logic
// - Loading state management
```

#### WebSocket Client (`utils/websocket.ts`)
```typescript
// TODO: Implement WebSocket client for:
// - Real-time conversation updates
// - Agent status changes
// - Notification delivery
// - Metric updates
// - Auto-reconnection logic
```

### Routing & Middleware

#### Authentication Middleware (`middleware/auth.ts`)
```typescript
// TODO: Implement auth checks:
// - Verify JWT token validity
// - Redirect to login if needed
// - Check route permissions
// - Handle token refresh
```

#### Organization Middleware (`middleware/organization.ts`)
```typescript
// TODO: Implement org checks:
// - Ensure organization selected
// - Verify organization access
// - Load organization context
```

### Composables

#### useAuth (`composables/useAuth.ts`)
```typescript
// TODO: Authentication composable:
// - Login/logout methods
// - Current user computed
// - Permission checking
// - Token management
```

#### useApi (`composables/useApi.ts`)
```typescript
// TODO: API composable:
// - Generic CRUD operations
// - Error handling
// - Loading states
// - Pagination helpers
```

#### useWebSocket (`composables/useWebSocket.ts`)
```typescript
// TODO: WebSocket composable:
// - Connection management
// - Event subscriptions
// - Message sending
// - Reconnection logic
```

#### useNotifications (`composables/useNotifications.ts`)
```typescript
// TODO: Notifications composable:
// - Show toast messages
// - Queue management
// - Persistence options
// - Action handling
```

### Testing Strategy

#### Unit Tests
```typescript
// TODO: Test components with Vitest:
// - Form validation
// - Component props/events
// - Store actions/getters
// - Utility functions
```

#### Integration Tests
```typescript
// TODO: Test user flows:
// - Authentication flow
// - Agent creation wizard
// - Playbook configuration
// - Conversation supervision
```

#### E2E Tests
```typescript
// TODO: Test critical paths with Playwright:
// - Complete onboarding
// - Create and configure agent
// - Handle conversation
// - Generate reports
```

## Performance Optimizations

### Code Splitting
- Lazy load route components
- Dynamic imports for heavy libraries
- Separate vendor bundles

### Caching Strategy
- API response caching
- Static asset caching
- Store persistence for offline support

### SEO & Meta Tags
- Dynamic meta tags per page
- Open Graph tags
- Structured data for documentation pages

## Accessibility Requirements

- WCAG 2.1 AA compliance
- Keyboard navigation support
- Screen reader compatibility
- Focus management
- ARIA labels and roles
- Color contrast compliance
- Responsive text sizing

## Security Considerations

- Content Security Policy headers
- XSS protection
- CSRF token handling
- Secure cookie settings
- Input sanitization
- File upload validation
- Rate limiting on client

## Deployment Configuration

### Environment Variables
```env
NUXT_PUBLIC_API_URL=
NUXT_PUBLIC_WS_URL=
NUXT_PUBLIC_SENTRY_DSN=
NUXT_PUBLIC_ANALYTICS_ID=
```

### Build Configuration
- Production optimizations
- Source map configuration
- Bundle analysis
- PWA manifest
- Service worker setup

## Development Guidelines

### Code Style
- Vue 3 Composition API with `<script setup>`
- TypeScript for type safety
- ESLint + Prettier configuration
- Conventional commits
- Component naming conventions

### Folder Structure
```
dashboard/
├── components/       # Reusable components
│   ├── ui/          # ShadCN components
│   ├── forms/       # Form components
│   ├── charts/      # Chart components
│   └── layout/      # Layout components
├── pages/           # Route pages
├── layouts/         # Layout templates
├── stores/          # Pinia stores
├── composables/     # Vue composables
├── utils/           # Utility functions
├── types/           # TypeScript types
├── plugins/         # Nuxt plugins
├── middleware/      # Route middleware
├── assets/          # Static assets
└── public/          # Public files
```

### Component Development Workflow
1. Create visual component with ShadCN
2. Add TODO comments for functionality
3. Implement mock data for development
4. Write component tests
5. Connect to API when backend ready
6. Add error handling and loading states
7. Optimize performance
8. Document component usage

## Next Steps

1. **Phase 1: Setup & Authentication**
   - Initialize Nuxt 3 project
   - Install and configure ShadCN Vue
   - Implement authentication pages
   - Setup routing and layouts

2. **Phase 2: Core Dashboard**
   - Build dashboard overview
   - Implement organization management
   - Create agent list and creation flow

3. **Phase 3: Agent Configuration**
   - Knowledge base import UI
   - Personality configuration
   - Playbook editor interface

4. **Phase 4: Conversation Management**
   - Conversation list and filters
   - Real-time conversation view
   - Supervision mode controls

5. **Phase 5: Analytics & Settings**
   - Analytics dashboard
   - Report builder
   - Settings pages
   - Billing integration

6. **Phase 6: Polish & Optimization**
   - Performance optimization
   - Accessibility audit
   - Security review
   - Documentation

---

This PRD provides a complete blueprint for building the Hay Dashboard with Vue 3, Nuxt 3, and ShadCN components, with clear TODO markers for functionality implementation.