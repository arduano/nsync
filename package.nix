{ nodejs, yarn, xz, gnutar, mkYarnPackage, buildFHSEnv, writeShellScriptBin, lib, pkgs, ... }:
let
  fhsDeps = pkgs: with pkgs; [
    nodejs
    yarn
    xz
    gnutar
  ];

  nsyncFhsUserEnv = buildFHSEnv {
    name = "nsync-env";
    targetPkgs = fhsDeps;
    runScript = "bash";
  };

  nsyncBuiltFile = mkYarnPackage {
    name = "nsync";
    src = ./.;
    packageJson = ./package.json;
    yarnLock = ./yarn.lock;

    buildInputs = [ yarn ];
    buildPhase = ''
      ${yarn}/bin/yarn build
    '';

    installPhase = ''
      mkdir $out
      mv deps/nsync/dist/main.js $out
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
