Feature: Agent and MCP tools
  The dashboard exposes safe, inspectable AI and MCP entry points.

  Scenario: open the AI chat surface
    Given I am on the "agent" route
    Then I can see "Ask about your cluster"
    And the page has no application errors

  Scenario: inspect the MCP tool catalog
    Given I am on the "mcp" route
    Then I can see "query_messages"
    And I can see "tools"
    And the page has no application errors

  Scenario: AI chat exposes the cluster context selector
    Given I am on the "agent" route
    Then I can see "cluster"
    And I can see "OpenAI"
