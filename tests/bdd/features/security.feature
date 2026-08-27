Feature: Authentication boundary
  A browser session can recover when the API requires a deployment token.

  Scenario: sign in after an expired session
    Given I am on the "overview" route
    When the API session expires
    Then I can see "Sign in to cluster-ui"
    When I sign in with token "bdd-token"
    Then the page body contains "Overview"
    And the page has no application errors
