{ nodejs_24, xz, gnutar, buildNpmPackage, buildFHSEnv, writeShellScriptBin, lib, pkgs, ... }:
let
  fhsDeps = pkgs: with pkgs; [
    nodejs_24
    xz
    gnutar
  ];

  nsyncFhsUserEnv = buildFHSEnv {
    name = "nsync-env";
    targetPkgs = fhsDeps;
    runScript = "bash";
  };

  nsyncBuiltFile = buildNpmPackage {
    name = "nsync";
    src = ./.;
    npmDepsHash = "sha256-hzGpEk6udgIGCN2wKgDsB9hfyyI+j8D5qmcYVq+r/Qs=";

    buildInputs = [ ];

    installPhase = ''
      mkdir $out
      mv dist/main.js $out
    '';

    doFixup = false;
    distPhase = "true"; # There seems to be no other way to disable it. This just disables it.
  };

  # Build a PATH variable for all deps
  path = lib.makeBinPath (fhsDeps pkgs);

  nsync = writeShellScriptBin "nsync" ''
    PATH=${path}:$PATH node ${nsyncBuiltFile}/main.js $@
  '';
in
{
  inherit nsync;
  inherit nsyncFhsUserEnv;
}
