const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ 
    headless: false,
    slowMo: 1000
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log('Navigating to login page...');
    await page.goto('http://localhost:3000/login');
    
    // Take a screenshot to see what's on the page
    await page.screenshot({ path: 'login-page.png' });
    console.log('Login page screenshot saved');
    
    // Wait for the page to load
    await page.waitForLoadState('networkidle');
    
    // Check if we're redirected or if login form is there
    const url = page.url();
    console.log('Current URL:', url);
    
    // Wait for and fill the email input
    console.log('Waiting for email input...');
    await page.waitForSelector('input[type="email"]', { timeout: 5000 });
    
    console.log('Logging in...');
    // Fill in login credentials
    await page.fill('input[type="email"]', 'test@test.com');
    await page.fill('input[type="password"]', 'Test@test1234');
    
    // Submit the form
    await page.click('button[type="submit"]');
    
    // Wait for navigation after login
    await page.waitForTimeout(3000); // Give time for login to process
    console.log('Login submitted, current URL:', page.url());
    
    // Navigate to the plugin page
    console.log('Navigating to Zendesk plugin page...');
    await page.goto('http://localhost:3000/integrations/plugins/hay-plugin-zendesk');
    
    // Wait for the page to load
    await page.waitForLoadState('networkidle');
    
    // Log console messages to see what's happening
    page.on('console', msg => console.log('Browser console:', msg.text()));
    
    // Reload to trigger console logs
    await page.reload();
    await page.waitForLoadState('networkidle');
    
    // Look for both slot indicators
    console.log('Looking for plugin slots...');
    
    // Check if the before-settings slot is visible
    const beforeSettingsVisible = await page.locator('text=/Before Settings Slot/').isVisible().catch(() => false);
    
    // Check if the after-settings slot is visible
    const afterSettingsVisible = await page.locator('text=/After Settings Slot/').isVisible().catch(() => false);
    
    if (beforeSettingsVisible && afterSettingsVisible) {
      console.log('✅ SUCCESS! Both slots are visible on the page!');
      console.log('  ✓ Before Settings slot: FOUND');
      console.log('  ✓ After Settings slot: FOUND');
      
      // Take a screenshot for verification
      await page.screenshot({ path: 'plugin-slots-success.png', fullPage: true });
      console.log('Screenshot saved as plugin-slots-success.png');
    } else {
      console.log('⚠️  Not all slots found:');
      console.log(`  ${beforeSettingsVisible ? '✓' : '✗'} Before Settings slot: ${beforeSettingsVisible ? 'FOUND' : 'NOT FOUND'}`);
      console.log(`  ${afterSettingsVisible ? '✓' : '✗'} After Settings slot: ${afterSettingsVisible ? 'FOUND' : 'NOT FOUND'}`);
      
      // Take a screenshot for debugging
      await page.screenshot({ path: 'plugin-slots-debug.png', fullPage: true });
      console.log('Debug screenshot saved as plugin-slots-debug.png');
      
      // Log page content for debugging
      const pageTitle = await page.title();
      console.log('Page title:', pageTitle);
    }
    
    // Keep the browser open for 3 seconds to observe
    console.log('Keeping browser open for observation...');
    await page.waitForTimeout(3000);
    
  } catch (error) {
    console.error('Error during test:', error);
    await page.screenshot({ path: 'plugin-slot-error.png', fullPage: true });
    console.log('Error screenshot saved as plugin-slot-error.png');
  } finally {
    await browser.close();
  }
})();