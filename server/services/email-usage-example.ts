/**
 * Email Service Usage Examples
 * 
 * This file demonstrates how to use the email service in the Hay platform.
 * These examples can be integrated into various parts of the application.
 */

import { emailService } from "./email.service";

/**
 * Example 1: Send a simple email
 */
async function sendSimpleEmail() {
  await emailService.initialize();

  const result = await emailService.sendEmail({
    to: "user@example.com",
    subject: "Test Email",
    html: "<h1>Hello World</h1><p>This is a test email.</p>",
    text: "Hello World\n\nThis is a test email.",
  });

  console.log("Email sent:", result);
}

/**
 * Example 2: Send a welcome email using template
 */
async function sendWelcomeEmail(userName: string, userEmail: string) {
  await emailService.initialize();

  const result = await emailService.sendTemplateEmail({
    to: userEmail,
    subject: "Welcome to Hay Platform",
    template: "welcome",
    variables: {
      userName,
      userEmail,
      companyName: "Hay Platform",
      dashboardUrl: "https://app.hay.chat/dashboard",
      helpCenterUrl: "https://help.hay.chat",
      documentationUrl: "https://docs.hay.chat",
      supportEmail: "support@hay.chat",
      verificationRequired: false,
      socialLinks: {
        twitter: "https://twitter.com/hayplatform",
        linkedin: "https://linkedin.com/company/hayplatform",
      },
      // Base template variables
      currentYear: new Date().getFullYear().toString(),
      companyAddress: "123 Tech Street, San Francisco, CA 94105",
      websiteUrl: "https://hay.chat",
      unsubscribeUrl: "https://hay.chat/unsubscribe",
      preferencesUrl: "https://hay.chat/preferences",
      recipientEmail: userEmail,
    },
  });

  return result;
}

/**
 * Example 3: Send password reset email
 */
async function sendPasswordResetEmail(
  userName: string,
  userEmail: string,
  resetToken: string,
  requestDetails: {
    ip: string;
    browser: string;
    location: string;
  }
) {
  await emailService.initialize();

  const resetLink = `https://hay.chat/reset-password?token=${resetToken}`;
  const requestTime = new Date().toLocaleString();

  const result = await emailService.sendTemplateEmail({
    to: userEmail,
    subject: "Reset Your Password",
    template: "reset-password",
    variables: {
      userName,
      userEmail,
      companyName: "Hay Platform",
      resetLink,
      expirationHours: "24",
      requestTime,
      requestIP: requestDetails.ip,
      requestBrowser: requestDetails.browser,
      requestLocation: requestDetails.location,
      supportEmail: "support@hay.chat",
      // Base template variables
      currentYear: new Date().getFullYear().toString(),
      companyAddress: "123 Tech Street, San Francisco, CA 94105",
      websiteUrl: "https://hay.chat",
      unsubscribeUrl: "https://hay.chat/unsubscribe",
      preferencesUrl: "https://hay.chat/preferences",
      recipientEmail: userEmail,
    },
  });

  return result;
}

/**
 * Example 4: Send notification email
 */
async function sendNotificationEmail(
  userEmail: string,
  notificationType: string,
  details: Record<string, any>
) {
  await emailService.initialize();

  const result = await emailService.sendTemplateEmail({
    to: userEmail,
    subject: notificationType,
    template: "notification",
    variables: {
      notificationTitle: notificationType,
      notificationSubtitle: "You have a new update",
      notificationIcon: "🔔",
      notificationMessage: `<p>${details.message}</p>`,
      userName: details.userName,
      actionRequired: details.actionRequired || false,
      actionMessage: details.actionMessage,
      actionButton: details.actionUrl ? {
        text: "View Details",
        url: details.actionUrl,
      } : undefined,
      details: details.items?.map((item: any) => ({
        label: item.label,
        value: item.value,
      })),
      notificationReason: "you have notifications enabled for this type of activity",
      notificationSettings: {
        url: "https://hay.chat/settings/notifications",
      },
      supportEmail: "support@hay.chat",
      companyName: "Hay Platform",
      timestamp: new Date().toLocaleString(),
      // Base template variables
      currentYear: new Date().getFullYear().toString(),
      companyAddress: "123 Tech Street, San Francisco, CA 94105",
      websiteUrl: "https://hay.chat",
      unsubscribeUrl: "https://hay.chat/unsubscribe",
      preferencesUrl: "https://hay.chat/preferences",
      recipientEmail: userEmail,
    },
  });

  return result;
}

/**
 * Example 5: Check email queue status
 */
async function checkEmailQueueStatus() {
  const status = emailService.getQueueStatus();
  
  console.log("Email Queue Status:");
  console.log(`- Pending: ${status.pending}`);
  console.log(`- Retry: ${status.retry}`);
  console.log(`- Failed: ${status.failed}`);
  
  if (status.failed > 0) {
    console.log("\nFailed emails:");
    status.items
      .filter(item => item.status === "failed")
      .forEach(item => {
        console.log(`  - ID: ${item.id}, Error: ${item.error}`);
      });
  }
  
  return status;
}

/**
 * Example 6: Retry failed emails
 */
async function retryFailedEmails() {
  const status = emailService.getQueueStatus();
  const failedEmails = status.items.filter(item => item.status === "failed");
  
  for (const email of failedEmails) {
    const success = emailService.retryEmail(email.id);
    if (success) {
      console.log(`Retrying email ${email.id}`);
    }
  }
}

/**
 * Example 7: Integration with user registration
 */
export async function onUserRegistration(user: {
  id: string;
  email: string;
  name: string;
}) {
  try {
    const result = await sendWelcomeEmail(user.name, user.email);
    if (result.success) {
      console.log(`Welcome email sent to ${user.email}`);
    } else {
      console.error(`Failed to send welcome email to ${user.email}:`, result.error);
    }
  } catch (error) {
    console.error("Error sending welcome email:", error);
  }
}

/**
 * Example 8: Integration with password reset request
 */
export async function onPasswordResetRequest(
  user: { id: string; email: string; name: string },
  resetToken: string,
  requestDetails: { ip: string; browser: string; location: string }
) {
  try {
    const result = await sendPasswordResetEmail(
      user.name,
      user.email,
      resetToken,
      requestDetails
    );
    
    if (result.success) {
      console.log(`Password reset email sent to ${user.email}`);
    } else {
      console.error(`Failed to send password reset email to ${user.email}:`, result.error);
    }
  } catch (error) {
    console.error("Error sending password reset email:", error);
  }
}

/**
 * Example 9: Batch email sending
 */
export async function sendBatchEmails(recipients: Array<{
  email: string;
  name: string;
  type: "welcome" | "notification";
  data: any;
}>) {
  await emailService.initialize();
  
  const results = await Promise.allSettled(
    recipients.map(async (recipient) => {
      if (recipient.type === "welcome") {
        return sendWelcomeEmail(recipient.name, recipient.email);
      } else if (recipient.type === "notification") {
        return sendNotificationEmail(recipient.email, "Update", recipient.data);
      }
      throw new Error(`Unknown recipient type: ${recipient.type}`);
    })
  );
  
  const successful = results.filter(r => r.status === "fulfilled").length;
  const failed = results.filter(r => r.status === "rejected").length;
  
  console.log(`Batch email results: ${successful} sent, ${failed} failed`);
  
  return { successful, failed, total: recipients.length };
}

// Export for use in other parts of the application
export {
  sendSimpleEmail,
  sendWelcomeEmail,
  sendPasswordResetEmail,
  sendNotificationEmail,
  checkEmailQueueStatus,
  retryFailedEmails,
};