{
  description = "cluster-ui — effect v4 cluster dashboard (Bull Board style, sqlite + redis)";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

  outputs = {
    self,
    nixpkgs,
  }: let
    systems = ["aarch64-darwin" "x86_64-darwin" "aarch64-linux" "x86_64-linux"];
    eachSystem = nixpkgs.lib.genAttrs systems;
  in {
    devShells = eachSystem (
      system: let
        pkgs = nixpkgs.legacyPackages.${system};
      in {
        default = pkgs.mkShell {
          packages = [
            pkgs.nodejs_24 # native TS (--experimental-transform-types), no tsx
            pkgs.pnpm
            # better-sqlite3 native builds (node-gyp)
            pkgs.python3
            pkgs.gnumake
            pkgs.gcc
            # handy for poking the cluster storage directly
            pkgs.sqlite
          ];

          shellHook = ''
            # pnpm refuses to run scripts from a store-owned home; keep its cache local
            export PNPM_HOME="$PWD/.direnv/pnpm"
            mkdir -p "$PNPM_HOME"
          '';
        };
      }
    );
  };
}
