// Rules component: pure evaluation of a ruleset against a task event.
export interface Decision {
  outcome: "approve" | "reject";
  firedRuleIds: string[];
}

export function createRulesEngine() {
  return {
    evaluate(): Decision {
      return { outcome: "approve", firedRuleIds: [] };
    },
  };
}
