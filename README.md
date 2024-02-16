# NSync

A TCP-less nix system synchronization tool.

System updates are encoded into instructions based on differences between git revisions of a flake, and sent to a remote system to be executed.

The remote system can accept the instructions and apply them, as long as it already has previous system builds that the instructions depend on.

For example, you could have the system built with git ref `v1`, then you make an instruction that builds `v2` that depends on `v1`, and the instruction only will encode the added packages between `v1` and `v2`. Then, the remote system can apply the instruction and make a generation for `v2`.

**Important:** NSync uses some NixOS internals, so there is a chance that breaking changes to some NixOS functionality can break NSync. For mission critical systems, try to keep the version of NixOS (and especially the `nix` command like utility) pinned.
