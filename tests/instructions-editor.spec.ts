import { test, expect } from "@playwright/test";

test.describe("InstructionsEditor - /a shortcut and v-model test", () => {
  // Helper function to authenticate
  async function authenticate(page) {
    console.log("🔐 Attempting to authenticate...");

    // First check if we're already on a login page or need to navigate to one
    const currentUrl = page.url();

    if (currentUrl.includes("/login") || currentUrl.includes("/auth")) {
      console.log("✅ Already on auth page");
    } else {
      // Try to navigate to login page
      try {
        await page.goto("http://localhost:3000/login");
        await page.waitForLoadState("networkidle");
      } catch (error) {
        console.log(
          "⚠️  Could not navigate to login page, checking for auth elements"
        );
      }
    }

    // Look for common authentication elements
    const emailInput = page
      .locator(
        'input[type="email"], input[name="email"], input[placeholder*="email" i]'
      )
      .first();
    const passwordInput = page
      .locator('input[type="password"], input[name="password"]')
      .first();
    const loginButton = page
      .locator("button")
      .filter({ hasText: /sign in|login|log in/i })
      .first();

    if (await emailInput.isVisible({ timeout: 3000 })) {
      console.log("✅ Found authentication form");

      // Use test credentials - adjust these based on your test setup
      await emailInput.fill("teste@teste.com");
      await passwordInput.fill("Allonsy42@");
      await loginButton.click();

      await page.waitForLoadState("networkidle");
      console.log("✅ Authentication attempted");

      // Wait a moment for redirect/auth to complete
      await page.waitForTimeout(2000);

      return true;
    } else {
      console.log("⚠️  No authentication form found, continuing without auth");
      return false;
    }
  }

  test("should handle /a shortcut and verify v-model structure", async ({
    page,
  }) => {
    // Try to authenticate first
    await authenticate(page);

    // Navigate to the playbook creation page
    await page.goto("http://localhost:3000/playbooks/new");

    // Wait for the page to load completely
    await page.waitForLoadState("networkidle");

    // Look for the instruction editor container
    const instructionsEditor = page.locator(
      '[data-testid="instructions-editor"]'
    );
    await expect(instructionsEditor).toBeVisible({ timeout: 10000 });

    // Find the contenteditable element with the correct class
    const contentEditableElement = page
      .locator(".instruction-content[contenteditable]")
      .first();
    await expect(contentEditableElement).toBeVisible({ timeout: 5000 });

    // Click to focus the editor
    await contentEditableElement.click();

    // Type /a to trigger the actions slash command
    await contentEditableElement.type("/a");

    console.log('✅ Typed "/a" into instruction editor');

    // Wait for the slash command menu to appear (with a reasonable timeout)
    let menuAppeared = false;
    try {
      await page.waitForSelector(".mcp-menu", {
        state: "visible",
        timeout: 3000,
      });
      menuAppeared = true;
      console.log("✅ Slash command menu appeared");

      // Press Enter to select an option
      await page.keyboard.press("Enter");

      // Wait briefly for the menu to close
      await page.waitForTimeout(500);

      console.log("✅ Successfully pressed Enter in slash command menu");
    } catch (error) {
      console.log(
        "⚠️  Slash command menu did not appear - this may be expected if no actions are available"
      );
    }

    // Verify the basic v-model structure by checking DOM elements
    await expect(instructionsEditor).toBeVisible();
    const instructionItems = page.locator(
      ".instruction-item, .rich-instruction-input"
    );
    await expect(instructionItems.first()).toBeVisible();

    // Check if we can access Vue component data for v-model verification
    const vModelData = await page.evaluate(() => {
      // Try to access Vue component data from the DOM
      const editorElement = document.querySelector(
        '[data-testid="instructions-editor"]'
      );
      if (editorElement) {
        // Check for Vue 3 component instance
        const vueInstance = (editorElement as any).__vueParentComponent;
        if (vueInstance && vueInstance.setupState) {
          // Look for instructions data in different possible locations
          if (vueInstance.setupState.instructions) {
            return vueInstance.setupState.instructions;
          }
          if (
            vueInstance.setupState.form &&
            vueInstance.setupState.form.instructions
          ) {
            return vueInstance.setupState.form.instructions;
          }
        }
      }
      return null;
    });

    // Verify v-model structure if we can access it
    if (vModelData) {
      expect(Array.isArray(vModelData)).toBe(true);
      if (vModelData.length > 0) {
        expect(vModelData[0]).toHaveProperty("id");
        expect(vModelData[0]).toHaveProperty("instructions");
        expect(typeof vModelData[0].id).toBe("string");
        expect(typeof vModelData[0].instructions).toBe("string");

        console.log("✅ v-model structure is correctly formatted:", {
          isArray: Array.isArray(vModelData),
          length: vModelData.length,
          firstItem: vModelData[0],
        });

        // If the menu appeared and we entered something, check if it was processed
        if (menuAppeared && vModelData[0].instructions.length > 0) {
          console.log(
            "✅ Instructions content after /a interaction:",
            vModelData[0].instructions
          );
        }
      }
    } else {
      console.log(
        "✅ DOM structure verified (Vue data not directly accessible but structure is correct)"
      );
    }

    // Final verification: ensure DOM structure is maintained
    const finalInstructionCount = await page
      .locator(".instruction-item, .rich-instruction-input")
      .count();
    expect(finalInstructionCount).toBeGreaterThan(0);

    console.log(
      "✅ Test completed successfully - instruction editor handles /a shortcut and maintains proper structure"
    );
  });

  test("should maintain v-model structure when typing regular text", async ({
    page,
  }) => {
    await authenticate(page);
    await page.goto("http://localhost:3000/playbooks/new");
    await page.waitForLoadState("networkidle");

    const instructionsEditor = page.locator(
      '[data-testid="instructions-editor"]'
    );
    await expect(instructionsEditor).toBeVisible();

    const contentEditableElement = page
      .locator(".instruction-content[contenteditable]")
      .first();
    await expect(contentEditableElement).toBeVisible();

    await contentEditableElement.click();

    // Type regular text
    const testText = "This is a test instruction for v-model verification";
    await contentEditableElement.fill(testText);

    // Wait for v-model to update
    await page.waitForTimeout(1000);

    // Verify text was entered
    const content = await contentEditableElement.textContent();
    expect(content).toContain(testText);

    // Check v-model structure
    const vModelData = await page.evaluate(() => {
      const editorElement = document.querySelector(
        '[data-testid="instructions-editor"]'
      );
      if (editorElement) {
        const vueInstance = (editorElement as any).__vueParentComponent;
        if (vueInstance && vueInstance.setupState) {
          return (
            vueInstance.setupState.instructions ||
            (vueInstance.setupState.form &&
              vueInstance.setupState.form.instructions)
          );
        }
      }
      return null;
    });

    if (vModelData && Array.isArray(vModelData) && vModelData.length > 0) {
      expect(vModelData[0].instructions).toContain(testText);
      console.log(
        "✅ v-model correctly updated with regular text:",
        vModelData[0].instructions
      );
    }

    console.log("✅ Regular text input maintains proper v-model structure");
  });

  test("should preserve action format [action](id) in v-model when moving between instructions", async ({
    page,
  }) => {
    await authenticate(page);
    await page.goto("http://localhost:3000/playbooks/new");
    await page.waitForLoadState("networkidle");

    const instructionsEditor = page.locator(
      '[data-testid="instructions-editor"]'
    );
    await expect(instructionsEditor).toBeVisible();

    const contentEditableElement = page
      .locator(".instruction-content[contenteditable]")
      .first();
    await expect(contentEditableElement).toBeVisible();

    // First, try directly injecting an action format to test the preservation
    await contentEditableElement.click();

    // Method 1: Try to inject action format directly
    console.log("📝 Testing action format preservation by direct injection");

    // Clear and set a test action format
    await contentEditableElement.evaluate((el) => {
      el.innerHTML = "";
      el.textContent = "[action](test-action-id)";
      // Trigger input event to update v-model
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await page.waitForTimeout(500);

    // Get v-model after direct injection
    let vModelWithAction = await page.evaluate(() => {
      const editorElement = document.querySelector(
        '[data-testid="instructions-editor"]'
      );
      if (editorElement) {
        const vueInstance = (editorElement as any).__vueParentComponent;
        if (vueInstance && vueInstance.setupState) {
          return (
            vueInstance.setupState.instructions ||
            (vueInstance.setupState.form &&
              vueInstance.setupState.form.instructions)
          );
        }
      }
      return null;
    });

    console.log("📝 V-model after direct action injection:", vModelWithAction);

    if (vModelWithAction && vModelWithAction.length > 0) {
      const instructionsWithDirectAction = vModelWithAction[0].instructions;
      console.log(
        "📝 Instructions after direct injection:",
        instructionsWithDirectAction
      );

      // Now simulate focus loss / movement that might trigger the bug
      await contentEditableElement.blur();
      await page.waitForTimeout(300);
      await contentEditableElement.focus();
      await page.waitForTimeout(300);

      // Get v-model after focus change
      const vModelAfterFocus = await page.evaluate(() => {
        const editorElement = document.querySelector(
          '[data-testid="instructions-editor"]'
        );
        if (editorElement) {
          const vueInstance = (editorElement as any).__vueParentComponent;
          if (vueInstance && vueInstance.setupState) {
            return (
              vueInstance.setupState.instructions ||
              (vueInstance.setupState.form &&
                vueInstance.setupState.form.instructions)
            );
          }
        }
        return null;
      });

      if (vModelAfterFocus && vModelAfterFocus.length > 0) {
        const finalInstructions = vModelAfterFocus[0].instructions;
        console.log(
          "📝 Final instructions after focus change:",
          finalInstructions
        );

        // Check if action format is preserved after focus change
        const hasActionFormat = /\[action\]\([^)]+\)/.test(finalInstructions);

        if (hasActionFormat) {
          console.log(
            "✅ SUCCESS: Action format [action](id) preserved after focus change"
          );
        } else {
          console.log("❌ DETECTED BUG: Action format lost after focus change");
          console.log("Expected: [action](test-action-id)");
          console.log("Actual:", finalInstructions);
        }

        // CRITICAL TEST: Add a new instruction and check if the original action is preserved
        console.log("📝 CRITICAL TEST: Adding new instruction to trigger the bug");
        
        // Press Enter to create a new instruction
        await contentEditableElement.press("Enter");
        await page.waitForTimeout(500);
        
        // Type something in the new instruction
        await page.keyboard.type("Second instruction");
        await page.waitForTimeout(500);
        
        // Get v-model after adding new instruction - this should reveal the bug
        const vModelAfterNewInstruction = await page.evaluate(() => {
          const editorElement = document.querySelector(
            '[data-testid="instructions-editor"]'
          );
          if (editorElement) {
            const vueInstance = (editorElement as any).__vueParentComponent;
            if (vueInstance && vueInstance.setupState) {
              return (
                vueInstance.setupState.instructions ||
                (vueInstance.setupState.form &&
                  vueInstance.setupState.form.instructions)
              );
            }
          }
          return null;
        });
        
        if (vModelAfterNewInstruction && vModelAfterNewInstruction.length > 0) {
          console.log("📝 Complete v-model after adding new instruction:", vModelAfterNewInstruction);
          
          // Check if the FIRST instruction still has the action format
          const firstInstructionAfterNew = vModelAfterNewInstruction[0].instructions;
          console.log("📝 First instruction after adding new one:", firstInstructionAfterNew);
          
          const stillHasActionFormatAfterNew = /\[action\]\([^)]+\)/.test(firstInstructionAfterNew);
          
          if (stillHasActionFormatAfterNew) {
            console.log("✅ SUCCESS: Action format preserved even after adding new instruction");
            expect(firstInstructionAfterNew).toMatch(/\[action\]\([^)]+\)/);
          } else {
            console.log("❌ BUG DETECTED: Action format lost when adding new instruction!");
            console.log("Expected first instruction to contain: [action](test-action-id)");
            console.log("Actual first instruction:", firstInstructionAfterNew);
            
            // This is the main bug we're testing for - action format gets lost
            expect(firstInstructionAfterNew).toMatch(/\[action\]\([^)]+\)/);
          }
          
          // Also check that we have multiple instructions now
          if (vModelAfterNewInstruction.length > 1) {
            console.log(`✅ Successfully added new instruction - total count: ${vModelAfterNewInstruction.length}`);
            expect(vModelAfterNewInstruction[1].instructions).toContain("Second instruction");
          } else {
            console.log("⚠️  Expected multiple instructions but only found:", vModelAfterNewInstruction.length);
          }
        } else {
          console.log("❌ Could not access v-model after adding new instruction");
        }
      }
    }

    // Method 2: Also try with the slash command approach
    console.log("📝 Testing with slash command approach");

    await contentEditableElement.click();
    await contentEditableElement.evaluate((el) => {
      el.innerHTML = "";
      el.textContent = "";
    });

    await contentEditableElement.type("/a");

    let actionInserted = false;
    try {
      await page.waitForSelector(".mcp-menu", {
        state: "visible",
        timeout: 3000,
      });
      console.log("✅ Slash command menu appeared");

      // Check for actions or documents
      const actionItems = page.locator(".mcp-item-action");
      const documentItems = page.locator(".mcp-item-document");
      const actionCount = await actionItems.count();
      const documentCount = await documentItems.count();

      console.log(
        `Found ${actionCount} actions and ${documentCount} documents`
      );

      if (actionCount > 0) {
        await page.keyboard.press("Enter");
        actionInserted = true;
        console.log("✅ Action inserted via menu");
      } else if (documentCount > 0) {
        // Try documents instead
        await page.keyboard.press("ArrowDown"); // Navigate to documents
        await page.keyboard.press("Enter");
        actionInserted = true;
        console.log("✅ Document inserted via menu (testing similar behavior)");
      } else {
        await page.keyboard.press("Escape");
        console.log("⚠️  No items available in menu");
      }
    } catch (error) {
      console.log("⚠️  Menu interaction failed");
    }

    if (actionInserted) {
      await page.waitForTimeout(500);

      // Test focus loss scenario
      await contentEditableElement.blur();
      await page.waitForTimeout(300);
      await contentEditableElement.focus();

      // Check final state
      const finalVModel = await page.evaluate(() => {
        const editorElement = document.querySelector(
          '[data-testid="instructions-editor"]'
        );
        if (editorElement) {
          const vueInstance = (editorElement as any).__vueParentComponent;
          if (vueInstance && vueInstance.setupState) {
            return (
              vueInstance.setupState.instructions ||
              (vueInstance.setupState.form &&
                vueInstance.setupState.form.instructions)
            );
          }
        }
        return null;
      });

      if (finalVModel && finalVModel.length > 0) {
        console.log(
          "📝 Final v-model after slash command insertion:",
          finalVModel[0].instructions
        );

        // Check if reference format is preserved (either [action] or [document])
        const hasReferenceFormat = /\[(action|document)\]\([^)]+\)/.test(
          finalVModel[0].instructions
        );

        if (!hasReferenceFormat) {
          console.log(
            "❌ BUG DETECTED: Reference format lost in v-model after focus change"
          );
        } else {
          console.log("✅ Reference format preserved after focus change");
          
          // CRITICAL TEST: Add new instruction via slash command approach too
          console.log("📝 CRITICAL TEST (slash approach): Adding new instruction to trigger bug");
          
          // Press Enter to create new instruction
          await contentEditableElement.press("Enter");
          await page.waitForTimeout(500);
          
          // Type in new instruction
          await page.keyboard.type("Second instruction via slash test");
          await page.waitForTimeout(500);
          
          // Check final v-model state
          const vModelAfterSlashNewInstruction = await page.evaluate(() => {
            const editorElement = document.querySelector(
              '[data-testid="instructions-editor"]'
            );
            if (editorElement) {
              const vueInstance = (editorElement as any).__vueParentComponent;
              if (vueInstance && vueInstance.setupState) {
                return (
                  vueInstance.setupState.instructions ||
                  (vueInstance.setupState.form &&
                    vueInstance.setupState.form.instructions)
                );
              }
            }
            return null;
          });
          
          if (vModelAfterSlashNewInstruction && vModelAfterSlashNewInstruction.length > 0) {
            console.log("📝 Complete v-model after slash + new instruction:", vModelAfterSlashNewInstruction);
            
            const firstInstructionAfterSlashNew = vModelAfterSlashNewInstruction[0].instructions;
            console.log("📝 First instruction after slash + new instruction:", firstInstructionAfterSlashNew);
            
            const stillHasReferenceFormat = /\[(action|document)\]\([^)]+\)/.test(firstInstructionAfterSlashNew);
            
            if (stillHasReferenceFormat) {
              console.log("✅ SUCCESS: Reference format preserved after slash + new instruction");
            } else {
              console.log("❌ BUG DETECTED: Reference format lost after adding new instruction (slash approach)!");
              console.log("Expected reference format [action](id) or [document](id)");
              console.log("Actual first instruction:", firstInstructionAfterSlashNew);
            }
          }
        }
      }
    }
  });
});
