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

        fhsDeps = pkgs: with pkgs; [
          nodejs
          yarn
          xz
          gnutar
        ];

        fhsUserEnv = pkgs.buildFHSEnv {
          name = "nsync-env";
          targetPkgs = fhsDeps;
          runScript = "bash";
        };

        nsyncBuiltFile = pkgs.mkYarnPackage {
          name = "nsync";
          src = ./.;
          packageJson = ./package.json;
          yarnLock = ./yarn.lock;

          buildInputs = [ pkgs.yarn ];
          buildPhase = ''
            ${pkgs.yarn}/bin/yarn build
          '';

          installPhase = ''
            mkdir $out
            mv deps/nsync/dist/main.js $out
          '';

          doFixup = false;
          distPhase = "true"; # There seems to be no other way to disable it. This just disables it.
        };

        # Build a PATH variable for all deps
        path = pkgs.lib.makeBinPath (fhsDeps pkgs);

        nsync = pkgs.writeShellScriptBin "nsync" ''
          PATH=${path}:$PATH node ${nsyncBuiltFile}/main.js $@
        '';
      in
      {
        # Devshell
        devShell = fhsUserEnv.env;

        # Run as package
        packages.default = nsync;
        packages.nsync = nsync;
      });
}
