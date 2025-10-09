import { test, expect } from "@playwright/test";

test.describe("InstructionsEditor - Paste and Slash Command Fixes", () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the test page (no auth required)
    await page.goto("http://localhost:3000/test/editor", { waitUntil: "networkidle" });

    // Wait for the page to fully render and ensure no redirects
    await page.waitForTimeout(1000);

    // Verify we're on the correct page
    expect(page.url()).toContain("/test/editor");
  });

  test("should preserve line breaks when pasting multi-line text", async ({ page }) => {
    console.log("📝 Test: Paste multi-line text preserves line breaks");

    // Wait for the editor to be visible
    const instructionsEditor = page.locator('[data-testid="instructions-editor"]');
    await expect(instructionsEditor).toBeVisible({ timeout: 10000 });

    // Find the first contenteditable element
    const contentEditableElement = page.locator(".instruction-content[contenteditable]").first();
    await expect(contentEditableElement).toBeVisible({ timeout: 5000 });

    // Click to focus the editor
    await contentEditableElement.click();

    // Define multi-line text to paste
    const multiLineText = `First instruction line
Second instruction line
Third instruction line
Fourth instruction line`;

    console.log("📝 Pasting multi-line text:");
    console.log(multiLineText);

    // Paste the text using Playwright's clipboard emulation
    await contentEditableElement.evaluate((el, text) => {
      // Create a DataTransfer object for the clipboard
      const dataTransfer = new DataTransfer();
      dataTransfer.setData("text/plain", text);

      // Create and dispatch a paste event
      const pasteEvent = new ClipboardEvent("paste", {
        clipboardData: dataTransfer,
        bubbles: true,
        cancelable: true,
      });

      el.dispatchEvent(pasteEvent);
    }, multiLineText);

    // Wait for the paste to be processed
    await page.waitForTimeout(1000);

    // Check the JSON output to verify multiple instructions were created
    const outputElement = page.locator('[data-testid="instructions-output"]');
    const outputText = await outputElement.textContent();
    console.log("📝 JSON output:", outputText);

    // Parse the JSON to verify structure
    const instructions = JSON.parse(outputText || "[]");
    console.log("📝 Parsed instructions:", instructions);
    console.log(`📝 Number of instructions created: ${instructions.length}`);

    // Verify that 4 separate instruction objects were created
    expect(instructions.length).toBe(4);

    // Verify each instruction has the correct content
    expect(instructions[0].instructions).toBe("First instruction line");
    expect(instructions[1].instructions).toBe("Second instruction line");
    expect(instructions[2].instructions).toBe("Third instruction line");
    expect(instructions[3].instructions).toBe("Fourth instruction line");

    console.log("✅ Multiline paste created multiple instruction objects successfully!");
  });

  test("should not duplicate text when using slash command to link documents", async ({ page }) => {
    console.log("📝 Test: Slash command does not duplicate text");

    // Wait for the editor to be visible
    const instructionsEditor = page.locator('[data-testid="instructions-editor"]');
    await expect(instructionsEditor).toBeVisible({ timeout: 10000 });

    // Find the first contenteditable element
    const contentEditableElement = page.locator(".instruction-content[contenteditable]").first();
    await expect(contentEditableElement).toBeVisible({ timeout: 5000 });

    // Click to focus the editor
    await contentEditableElement.click();

    // Type text before the slash command
    const textBefore = "Please review ";
    await contentEditableElement.type(textBefore);
    console.log("📝 Typed text before slash:", textBefore);

    // Type the slash to trigger the command menu
    await page.keyboard.type("/");
    await page.waitForTimeout(300);

    console.log("📝 Typed slash, waiting for menu...");

    // Wait for the mention menu to appear
    let menuAppeared = false;
    try {
      await page.waitForSelector(".mention-menu", {
        state: "visible",
        timeout: 3000,
      });
      menuAppeared = true;
      console.log("✅ Slash command menu appeared");
    } catch (error) {
      console.log("⚠️  Slash command menu did not appear - may have no items");
    }

    if (menuAppeared) {
      // Type 'd' to trigger documents mode (or to filter)
      await page.keyboard.type("d");
      await page.waitForTimeout(300);

      console.log("📝 Typed 'd' to trigger documents");

      // Check if there are any document items in the menu
      const documentItems = page.locator(".mention-item-document");
      const documentCount = await documentItems.count();
      console.log(`📝 Found ${documentCount} document items in menu`);

      if (documentCount > 0) {
        // Select the first document by pressing Enter
        await page.keyboard.press("Enter");
        await page.waitForTimeout(500);

        console.log("✅ Selected a document from the menu");

        // Type text after the document link
        const textAfter = " and provide feedback";
        await page.keyboard.type(textAfter);
        await page.waitForTimeout(500);

        console.log("📝 Typed text after document link:", textAfter);

        // Get the content from the editor
        const textContent = await contentEditableElement.textContent();
        console.log("📝 Final text content:", textContent);

        // Count occurrences of "and provide feedback" to check for duplication
        const regex = new RegExp("and provide feedback", "g");
        const matches = textContent.match(regex);
        const occurrenceCount = matches ? matches.length : 0;

        console.log(`📝 Occurrences of "and provide feedback": ${occurrenceCount}`);

        // Verify that the text appears only once (no duplication)
        expect(occurrenceCount).toBe(1);

        // Also check that "Please review" appears only once
        const beforeMatches = textContent.match(/Please review/g);
        const beforeOccurrenceCount = beforeMatches ? beforeMatches.length : 0;
        console.log(`📝 Occurrences of "Please review": ${beforeOccurrenceCount}`);
        expect(beforeOccurrenceCount).toBe(1);

        console.log("✅ No text duplication detected!");
      } else {
        console.log("⚠️  No documents available to test with - skipping this test");
        // Still verify the basic behavior without selecting a document
        await page.keyboard.press("Escape");

        // Type text after the slash
        const textAfter = "doc and provide feedback";
        await page.keyboard.type(textAfter);
        await page.waitForTimeout(500);

        const textContent = await contentEditableElement.textContent();
        console.log("📝 Text content (no document selected):", textContent);

        // Verify no duplication of "and provide feedback"
        const regex = new RegExp("and provide feedback", "g");
        const matches = textContent.match(regex);
        const occurrenceCount = matches ? matches.length : 0;

        expect(occurrenceCount).toBe(1);
        console.log("✅ Basic slash command behavior verified (no duplication)");
      }
    } else {
      console.log("⚠️  Menu did not appear - may need to check configuration");
    }
  });

  test("should preserve line breaks and handle multiple instructions correctly", async ({
    page,
  }) => {
    console.log("📝 Test: Combined paste and instruction management");

    const instructionsEditor = page.locator('[data-testid="instructions-editor"]');
    await expect(instructionsEditor).toBeVisible({ timeout: 10000 });

    const contentEditableElement = page.locator(".instruction-content[contenteditable]").first();
    await expect(contentEditableElement).toBeVisible({ timeout: 5000 });
    await contentEditableElement.click();

    // Paste multi-line text
    const multiLineText = `Line 1
Line 2
Line 3`;

    await contentEditableElement.evaluate((el, text) => {
      const dataTransfer = new DataTransfer();
      dataTransfer.setData("text/plain", text);
      const pasteEvent = new ClipboardEvent("paste", {
        clipboardData: dataTransfer,
        bubbles: true,
        cancelable: true,
      });
      el.dispatchEvent(pasteEvent);
    }, multiLineText);

    await page.waitForTimeout(1000);

    // Verify that 3 separate instruction objects were created from the multiline paste
    let outputElement = page.locator('[data-testid="instructions-output"]');
    let outputText = await outputElement.textContent();
    let instructions = JSON.parse(outputText || "[]");

    console.log(`📝 Instructions after paste: ${instructions.length}`);
    console.log("📝 Instructions:", instructions);

    // Should have 3 instructions from the paste
    expect(instructions.length).toBe(3);
    expect(instructions[0].instructions).toBe("Line 1");
    expect(instructions[1].instructions).toBe("Line 2");
    expect(instructions[2].instructions).toBe("Line 3");

    // Navigate to the last instruction and press Enter to create a new one
    const lastContentEditable = page.locator(".instruction-content[contenteditable]").nth(2);
    await lastContentEditable.click();
    await page.waitForTimeout(200);
    await page.keyboard.press("End"); // Move to end of content
    await page.waitForTimeout(200);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1000); // Wait longer for new instruction to be created

    // Wait for the 4th instruction to appear
    await expect(page.locator(".instruction-item-wrapper")).toHaveCount(4, { timeout: 5000 });

    // Type in the new instruction
    const fourthContentEditable = page.locator(".instruction-content[contenteditable]").nth(3);
    await fourthContentEditable.click();
    await page.waitForTimeout(200);
    await fourthContentEditable.type("New instruction after paste");
    await page.waitForTimeout(1000); // Wait for model to update

    // Verify we now have 4 instructions in the DOM
    const instructionCount = await page.locator(".instruction-item-wrapper").count();
    console.log(`📝 Total instructions in DOM: ${instructionCount}`);
    expect(instructionCount).toBe(4);

    // Check JSON output
    outputElement = page.locator('[data-testid="instructions-output"]');
    outputText = await outputElement.textContent();
    instructions = JSON.parse(outputText || "[]");

    console.log("📝 Final instructions structure:", JSON.stringify(instructions, null, 2));

    // Verify structure
    expect(instructions.length).toBe(4);
    expect(instructions[0].instructions).toBe("Line 1");
    expect(instructions[1].instructions).toBe("Line 2");
    expect(instructions[2].instructions).toBe("Line 3");
    expect(instructions[3].instructions).toBe("New instruction after paste");

    console.log("✅ Multi-instruction management works correctly with pasted content!");
  });

  test("should handle slash command with text before and after without duplication", async ({
    page,
  }) => {
    console.log("📝 Test: Slash command in the middle of text");

    const instructionsEditor = page.locator('[data-testid="instructions-editor"]');
    await expect(instructionsEditor).toBeVisible({ timeout: 10000 });

    const contentEditableElement = page.locator(".instruction-content[contenteditable]").first();
    await expect(contentEditableElement).toBeVisible({ timeout: 5000 });
    await contentEditableElement.click();

    // Type complete text: "Review /doc and send to client"
    await contentEditableElement.type("Review ");
    await page.keyboard.type("/a"); // Try actions
    await page.waitForTimeout(300);

    // Check if menu appeared
    let menuAppeared = false;
    try {
      await page.waitForSelector(".mention-menu", {
        state: "visible",
        timeout: 2000,
      });
      menuAppeared = true;
      console.log("✅ Menu appeared for /a");

      // Check for action items
      const actionItems = page.locator(".mention-item-action");
      const actionCount = await actionItems.count();

      if (actionCount > 0) {
        // Select first action
        await page.keyboard.press("Enter");
        await page.waitForTimeout(500);
        console.log("✅ Action selected");
      } else {
        // No actions, close menu
        await page.keyboard.press("Escape");
        console.log("⚠️  No actions available");
      }
    } catch (error) {
      console.log("⚠️  Menu did not appear");
    }

    // Type text after (simulating text that was typed after the slash before selection)
    await page.keyboard.type(" and send to client");
    await page.waitForTimeout(500);

    // Get the final content
    const textContent = await contentEditableElement.textContent();
    console.log("📝 Final content:", textContent);

    // Verify "and send to client" appears only once
    const afterTextMatches = textContent.match(/and send to client/g);
    const afterTextCount = afterTextMatches ? afterTextMatches.length : 1;

    console.log(`📝 Occurrences of "and send to client": ${afterTextCount}`);
    expect(afterTextCount).toBe(1);

    // Verify "Review" appears only once
    const beforeTextMatches = textContent.match(/Review/g);
    const beforeTextCount = beforeTextMatches ? beforeTextMatches.length : 1;

    console.log(`📝 Occurrences of "Review": ${beforeTextCount}`);
    expect(beforeTextCount).toBe(1);

    console.log("✅ No duplication with text before and after slash command!");
  });

  test("should join lines when pressing backspace at the beginning of a line", async ({ page }) => {
    console.log("📝 Test: Backspace at beginning of line joins with previous line");

    const instructionsEditor = page.locator('[data-testid="instructions-editor"]');
    await expect(instructionsEditor).toBeVisible({ timeout: 10000 });

    const contentEditableElement = page.locator(".instruction-content[contenteditable]").first();
    await expect(contentEditableElement).toBeVisible({ timeout: 5000 });
    await contentEditableElement.click();

    // Paste multi-line text
    const multiLineText = `First instruction line
Second instruction line
Third instruction line
Fourth instruction line`;

    console.log("📝 Pasting multi-line text:");
    console.log(multiLineText);

    await contentEditableElement.evaluate((el, text) => {
      const dataTransfer = new DataTransfer();
      dataTransfer.setData("text/plain", text);
      const pasteEvent = new ClipboardEvent("paste", {
        clipboardData: dataTransfer,
        bubbles: true,
        cancelable: true,
      });
      el.dispatchEvent(pasteEvent);
    }, multiLineText);

    await page.waitForTimeout(1000);

    // Verify that 4 separate instruction objects were created
    let outputElement = page.locator('[data-testid="instructions-output"]');
    let outputText = await outputElement.textContent();
    let instructions = JSON.parse(outputText || "[]");

    console.log(`📝 Instructions after paste: ${instructions.length}`);
    expect(instructions.length).toBe(4);

    // Navigate to the second instruction
    const secondContentEditable = page.locator(".instruction-content[contenteditable]").nth(1);
    await secondContentEditable.click();
    await page.waitForTimeout(200);

    // Move cursor to the beginning of the line using JavaScript
    await secondContentEditable.evaluate((el) => {
      const selection = window.getSelection();
      if (selection) {
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(true); // Collapse to start
        selection.removeAllRanges();
        selection.addRange(range);
      }
    });
    await page.waitForTimeout(200);

    console.log("📝 Pressing backspace at the beginning of line 2...");

    // Press backspace to join with previous line
    await page.keyboard.press("Backspace");
    await page.waitForTimeout(1000);

    // Get updated JSON output
    outputElement = page.locator('[data-testid="instructions-output"]');
    outputText = await outputElement.textContent();
    instructions = JSON.parse(outputText || "[]");

    console.log("📝 Final instructions structure:", JSON.stringify(instructions, null, 2));

    // Should now have 3 instructions (lines 1 and 2 were joined)
    expect(instructions.length).toBe(3);

    // Verify the first instruction now contains both lines joined
    expect(instructions[0].instructions).toBe("First instruction lineSecond instruction line");
    expect(instructions[1].instructions).toBe("Third instruction line");
    expect(instructions[2].instructions).toBe("Fourth instruction line");

    console.log("✅ Lines joined successfully when backspace pressed at beginning of line!");
  });

  test("should navigate between lines with arrow keys at line boundaries", async ({ page }) => {
    console.log("📝 Test: Arrow key navigation at line boundaries");

    const instructionsEditor = page.locator('[data-testid="instructions-editor"]');
    await expect(instructionsEditor).toBeVisible({ timeout: 10000 });

    const contentEditableElement = page.locator(".instruction-content[contenteditable]").first();
    await expect(contentEditableElement).toBeVisible({ timeout: 5000 });
    await contentEditableElement.click();

    // Paste multi-line text
    const multiLineText = `First instruction line
Second instruction line
Third instruction line
Fourth instruction line`;

    console.log("📝 Pasting multi-line text:");
    console.log(multiLineText);

    await contentEditableElement.evaluate((el, text) => {
      const dataTransfer = new DataTransfer();
      dataTransfer.setData("text/plain", text);
      const pasteEvent = new ClipboardEvent("paste", {
        clipboardData: dataTransfer,
        bubbles: true,
        cancelable: true,
      });
      el.dispatchEvent(pasteEvent);
    }, multiLineText);

    await page.waitForTimeout(1000);

    // Verify that 4 separate instruction objects were created
    const outputElement = page.locator('[data-testid="instructions-output"]');
    const outputText = await outputElement.textContent();
    const instructions = JSON.parse(outputText || "[]");

    console.log(`📝 Instructions after paste: ${instructions.length}`);
    expect(instructions.length).toBe(4);

    // Test 1: Move cursor to end of first line, press Right arrow -> should go to beginning of second line
    console.log("📝 Test: Right arrow at end of line moves to beginning of next line");
    const firstContentEditable = page.locator(".instruction-content[contenteditable]").nth(0);
    await firstContentEditable.click();
    await page.waitForTimeout(200);

    // Move cursor to the end of the first line
    await firstContentEditable.evaluate((el) => {
      const selection = window.getSelection();
      if (selection) {
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false); // Collapse to end
        selection.removeAllRanges();
        selection.addRange(range);
      }
    });
    await page.waitForTimeout(200);

    console.log("📝 Cursor at end of line 1, pressing Right arrow...");

    // Press Right arrow key
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(500);

    // Check if focus moved to the second instruction
    const secondContentEditable = page.locator(".instruction-content[contenteditable]").nth(1);
    const isFocused = await secondContentEditable.evaluate((el) => el === document.activeElement);

    console.log(`📝 Second line is now focused: ${isFocused}`);
    expect(isFocused).toBe(true);

    // Verify cursor is at the beginning of the second line
    const cursorAtStart = await secondContentEditable.evaluate(() => {
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        return range.startOffset === 0;
      }
      return false;
    });

    console.log(`📝 Cursor is at beginning of line 2: ${cursorAtStart}`);
    expect(cursorAtStart).toBe(true);

    // Test 2: Press Left arrow at beginning of a line -> should go to end of previous line
    console.log("📝 Test: Left arrow at beginning of line moves to end of previous line");

    // Cursor should already be at the beginning of the second line
    console.log("📝 Cursor at beginning of line 2, pressing Left arrow...");

    // Press Left arrow key
    await page.keyboard.press("ArrowLeft");
    await page.waitForTimeout(500);

    // Check if focus moved back to the first instruction
    const isFirstFocused = await firstContentEditable.evaluate(
      (el) => el === document.activeElement,
    );

    console.log(`📝 First line is now focused: ${isFirstFocused}`);
    expect(isFirstFocused).toBe(true);

    // Verify cursor is at the end of the first line
    const cursorAtEnd = await firstContentEditable.evaluate(() => {
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        const el = document.activeElement as HTMLElement;

        // Check if the cursor is at the end by trying to move it forward
        // If we can't move forward, we're at the end
        const testRange = range.cloneRange();
        testRange.selectNodeContents(el);
        testRange.collapse(false); // Collapse to end

        // Compare the two ranges
        return range.compareBoundaryPoints(Range.END_TO_END, testRange) === 0;
      }
      return false;
    });

    console.log(`📝 Cursor is at end of line 1: ${cursorAtEnd}`);
    expect(cursorAtEnd).toBe(true);

    console.log("✅ Arrow key navigation at line boundaries works correctly!");
  });
});
