Feature: Workflow run investigation
  Operators can move from a workflow to a run, compare attempts, and inspect its history.

  Scenario: open a workflow run
    Given I am on the "workflows" route
    When I open the first workflow
    Then I can see "workflow executions"
    When I open the first workflow run
    Then the workflow run detail panel is visible
    And I can see "Event history"
    And the page has no application errors

  Scenario: view the workflow run graph and timeline
    Given I am on the "workflows" route
    When I open the first workflow
    And I open the first workflow run
    When I choose the "DAG" workflow view
    Then I can see "Flow"
    When I choose the "Timeline" workflow view
    Then I can see "Flow"
    And the page has no application errors

  Scenario: inspect activity attempts and payloads
    Given I am on the "workflows" route
    When I open the first workflow
    And I open the first workflow run
    Then I can see "Event history"
    And I can see "show payload"
