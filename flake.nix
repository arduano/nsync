{
  description = "Nsync - A TCP-less nix system synchronization tool";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils, ... }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
        nsyncPkg = pkgs.callPackage ./package.nix { };
      in {
        packages = {
          default = nsyncPkg.nsync;
          nsync = nsyncPkg.nsync;
        };

        apps.default = {
          type = "app";
          program = "${nsyncPkg.nsync}/bin/nsync";
        };

        devShells.default = nsyncPkg.nsyncFhsUserEnv.env;
      }
    ) // {
      overlays.default = final: prev: {
        nsync = final.callPackage ./package.nix { };
      };
    };
}
