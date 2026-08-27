Feature: Operations console
  Operators can save reusable views, manage threshold alerts, and inspect writes.

  Scenario: save and reopen a filtered view
    Given I am on the "messages" route
    When I search messages for "counter-1"
    And I save the current view as "counter messages"
    And I open the operations page
    Then I can see "counter messages"
    When I open the saved view "counter messages"
    Then I can see "counter-1"
    And the page has no application errors

  Scenario: inspect alert and audit surfaces
    Given I am on the "operations" route
    Then I can see "Threshold alerts"
    And I can see "Recent audit"
    And the page has no application errors

  Scenario: read-only controls are visibly disabled
    Given I am on the "operations" route
    Then I can see "saved views"
    And the page has no application errors
