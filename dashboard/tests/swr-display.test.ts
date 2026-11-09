// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { defineComponent, h, nextTick } from "vue";
import { mount } from "@vue/test-utils";
import { MessageSquare } from "lucide-vue-next";
import MetricCard from "../components/MetricCard.vue";
import RefreshIndicator from "../components/ui/RefreshIndicator.vue";
import SettleValue from "../components/ui/SettleValue.vue";

const passthrough = defineComponent({
  setup(_, { slots }) {
    return () => h("div", slots.default?.());
  },
});

const mountCard = (props: Record<string, unknown>) =>
  mount(MetricCard, {
    props: { title: "Total", icon: MessageSquare, metric: 0, ...props },
    global: {
      components: { SettleValue },
      stubs: { Card: passthrough, CardHeader: passthrough, CardContent: passthrough },
    },
  });

describe("SettleValue", () => {
  it("does not animate when first shown or when the value is unchanged", async () => {
    const wrapper = mount(SettleValue, { props: { value: 5 } });
    expect(wrapper.find(".data-settle").exists()).toBe(false);

    await wrapper.setProps({ value: 5 });
    expect(wrapper.find(".data-settle").exists()).toBe(false);
  });

  it("animates when the value changes", async () => {
    const wrapper = mount(SettleValue, { props: { value: 5 } });

    await wrapper.setProps({ value: 6 });

    expect(wrapper.find(".data-settle").exists()).toBe(true);
    expect(wrapper.text()).toBe("6");
  });
});

describe("MetricCard", () => {
  it("shows a placeholder, not a false zero, while loading", () => {
    const wrapper = mountCard({ loading: true, metric: 0, subtitle: "0" });

    expect(wrapper.find('[data-testid="metric-skeleton"]').exists()).toBe(true);
    expect(wrapper.text()).not.toContain("0");
  });

  it("does not animate when the first real value replaces the placeholder", async () => {
    const wrapper = mountCard({ loading: true });

    await wrapper.setProps({ loading: false, metric: 42 });
    await nextTick();

    expect(wrapper.text()).toContain("42");
    expect(wrapper.find(".data-settle").exists()).toBe(false);
  });

  it("animates a value that changes after it was shown", async () => {
    const wrapper = mountCard({ metric: 42 });

    await wrapper.setProps({ metric: 43 });

    expect(wrapper.find(".data-settle").exists()).toBe(true);
  });
});

describe("RefreshIndicator", () => {
  it("keeps its footprint when idle and announces only while active", async () => {
    const wrapper = mount(RefreshIndicator, {
      props: { active: false },
      global: { mocks: { $t: (key: string) => key } },
    });

    expect(wrapper.classes()).toContain("h-4");
    expect(wrapper.classes()).toContain("opacity-0");
    expect(wrapper.text()).toBe("");

    await wrapper.setProps({ active: true });

    expect(wrapper.classes()).toContain("h-4");
    expect(wrapper.classes()).toContain("opacity-100");
    expect(wrapper.text()).toBe("common.updating");
  });
});
