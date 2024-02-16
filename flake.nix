{
  description = "A development shell with FHS environment containing Node.js, xz, and tar";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils, ... }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs {
          inherit system;
          overlays = [ ];
        };

        nsync = pkgs.callPackage ./package.nix { };
      in
      {
        # Devshell
        devShell = nsync.nsyncFhsUserEnv.env;

        # Run as package
        packages.default = nsync.nsync;
        packages.nsync = nsync.nsync;

        # Export the package in an overlay
        overlay = final: prev: {
          nsync = final.pkgs.callPackage ./package.nix { };
        };
      });
}
