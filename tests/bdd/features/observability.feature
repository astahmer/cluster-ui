Feature: Operational observability
  Operators can correlate activity across overview charts, traces, and live updates.

  Scenario: change the overview metrics window
    Given I am on the "overview" route
    When I choose the "7d" metrics range
    Then I can see "Activity — 7d"
    And the page has no application errors

  Scenario: brush a time range and link it to messages
    Given I am on the "overview" route
    When I select a time range on the "Pending depth" chart
    Then I can see "Messages"
    And I can see "Traces"
    When I open the brushed messages view
    Then the page body contains "Messages"

  Scenario: inspect a trace waterfall
    Given I am on the "traces" route
    When I open the first trace
    Then I can see "waterfall"
    And I can see "spans"
    And the page has no application errors

  Scenario: trace detail is addressable
    Given I am on the "traces" route
    When I open the first trace
    And I reload the current URL
    Then I can see "waterfall"
    And the page has no application errors
