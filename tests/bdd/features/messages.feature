Feature: Message investigation
  Operators can search, filter, page through, and inspect cluster messages.

  Background:
    Given I am on the "messages" route

  Scenario: inspect a message from the list
    Then I can see "counter-1"
    When I open the first message row
    Then the message detail panel is visible
    And I can see "message"
    And the page has no application errors

  Scenario: deep link to an open message
    When I open the first message row
    And I reload the current URL
    Then the message detail panel is visible
    And the page has no application errors

  Scenario: filter messages by status
    When I choose the "Failed" message tab
    Then I can see "Failed"
    And the page has no application errors

  Scenario: search messages by entity id
    When I search messages for "counter-1"
    Then I can see "counter-1"
    And the page has no application errors

  Scenario: paginate messages
    When I change the message page size to "25"
    Then I can see "page 1"
    And the page has no application errors

  Scenario: export the visible messages
    When I export messages as JSON
    Then the page has no application errors
