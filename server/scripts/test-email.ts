import { AppDataSource } from "../database/data-source";
import { EmailService } from "../services/email.service";

async function testEmail() {
  try {
    console.log("🔧 Initializing database...");
    await AppDataSource.initialize();

    console.log("📧 Initializing email service...");
    const emailService = new EmailService();
    await emailService.initialize();

    const testEmail = "roger@rogerjunior.com"; // Change this to your email

    console.log(`📤 Sending test email to ${testEmail}...`);
    const result = await emailService.sendEmail({
      to: testEmail,
      subject: "Test Email from Hay - GDPR Privacy System",
      html: `
        <html>
          <body style="font-family: Arial, sans-serif; padding: 20px;">
            <h1 style="color: #4F46E5;">Test Email</h1>
            <p>This is a test email to verify SMTP configuration.</p>
            <p><strong>Timestamp:</strong> ${new Date().toISOString()}</p>
            <p><strong>From:</strong> Hay Privacy System</p>
            <hr style="margin: 20px 0;" />
            <p style="color: #6B7280; font-size: 12px;">
              If you received this email, your SMTP configuration is working correctly!
            </p>
          </body>
        </html>
      `,
    });

    console.log("✅ Email sent successfully!");
    console.log("📊 Result:", JSON.stringify(result, null, 2));
    console.log("\n🔍 Next steps:");
    console.log("1. Check your inbox (and spam folder) for the test email");
    console.log("2. If you don't see it, check your Resend dashboard for delivery status");
    console.log("3. Verify that your domain is properly configured in Resend");

    await AppDataSource.destroy();
  } catch (error) {
    console.error("❌ Error sending test email:", error);
    process.exit(1);
  }
}

testEmail();
