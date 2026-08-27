Feature: Dashboard navigation and shared shell
  The operator can move through every dashboard surface from one consistent shell.

  Scenario Outline: open a dashboard surface
    Given I am on the "<route>" route
    Then the page body contains "<text>"
    And the page has no application errors

    Examples:
      | route      | text       |
      | overview   | Overview   |
      | runners    | Runners    |
      | shards     | Shards     |
      | queues     | Queues     |
      | entities   | Entities   |
      | workflows  | Workflows  |
      | crons      | Crons      |
      | traces     | Traces     |
      | singletons | Runtime    |
      | messages   | Messages   |
      | agent      | AI Chat    |
      | mcp        | MCP        |
      | operations | Operations |

  Scenario: use the command palette to jump to a page
    Given I am on the "overview" route
    When I open the command palette
    Then I can see "Go to Messages"
    When I choose the command "Go to Queues"
    Then the page body contains "Queues"

  Scenario: switch between configured clusters
    Given I am on the "queues" route
    When I switch to the "local-redis" cluster
    Then the page body contains "payments"
    When I switch to the "default" cluster
    Then the page body contains "redis-backed"
