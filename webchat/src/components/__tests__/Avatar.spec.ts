import { describe, it, expect } from "vitest";
import { computed, defineComponent, h, provide } from "vue";
import { mount } from "@vue/test-utils";
import Avatar, { ASSISTANT_AVATAR_PRESET } from "../Avatar.vue";
import type { AssistantAvatarPreset } from "@/types";

/** The assistant's avatar: its picture, else the icon picked in Settings > Webchat. */
function render(preset: AssistantAvatarPreset | null, src: string | null = null) {
  const Root = defineComponent({
    setup() {
      if (preset)
        provide(
          ASSISTANT_AVATAR_PRESET,
          computed(() => preset),
        );
      return () => h(Avatar, { kind: "ai", name: "Ava", src });
    },
  });
  return mount(Root);
}

describe("Avatar (assistant)", () => {
  it("draws the sparkle when no preset is given", () => {
    expect(render(null).html()).toContain("M12 2.5");
  });

  it("draws the picked preset", () => {
    expect(render("robot").find("svg path").attributes("fill-rule")).toBe("evenodd");
    expect(render("sparkles").findAll("svg path")).toHaveLength(2);
  });

  it("shows the uploaded picture over the preset", () => {
    const wrapper = render("robot", "https://cdn.example/ava.png");
    expect(wrapper.find("img").attributes("src")).toBe("https://cdn.example/ava.png");
    expect(wrapper.find("svg").exists()).toBe(false);
  });
});
