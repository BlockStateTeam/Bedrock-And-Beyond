import { MolangVariableMap, system, ItemStack } from "@minecraft/server";

export function handleVineUpdate(action, block, vineData) {
    switch (action) {
        case "break": {
            system.runTimeout(() => {
                handleVineUpdate("chain_update", block.above(), vineData);
                handleVineUpdate("chain_update", block.below(), vineData);
            });
            break;
        }

        case "place": {
            // We only need to update the block above.
            // The block above will naturally chain the update DOWN to this newly placed block!
            if (block.above().isAir) {
                block.dimension.runCommand(
                    `setblock ${returnCoordInCmdForm(block.location)} air destroy`,
                );
                return;
            }
            if (block.below().isAir) {
                // Check if the current block is already an "end" block. If it is, we don't need to change it, since it's still the end even with a new vine above it. If it's not, then we need to change it to an "end" block, since it now IS the end with a vine above it.
                if (vineData.block_type_to_set_if_end.includes(block.typeId)) {
                    return;
                }
                block.setType(vineData.block_type_to_set_if_end[0]);
                return;
            }
            system.runTimeout(() => {
                handleVineUpdate("chain_update", block.above(), vineData);
            });
            break;
        }

        case "chain_update": {
            if (
                !vineData.block_type_to_set_if_end.includes(block.typeId) &&
                block.typeId !== vineData.block_type_to_set_if_not_end
            ) {
                return;
            }

            if (block.above().isAir) {
                block.dimension.runCommand(
                    `setblock ${returnCoordInCmdForm(block.location)} air destroy`,
                );
                return;
            }

            // OPTIMIZATION: Store the current state to check if we actually change anything
            const originalTypeId = block.typeId;

            const isVineBelow =
                vineData.block_type_to_set_if_end.includes(
                    block.below().typeId,
                ) ||
                block.below().typeId === vineData.block_type_to_set_if_not_end;
            if (isVineBelow) {
                // There IS a vine below, so this is NOT the end.
                if (block.typeId !== vineData.block_type_to_set_if_not_end) {
                    block.setType(vineData.block_type_to_set_if_not_end);
                }

                // PERFORMANCE GUARD:
                // Only chain update downward if this block's state ACTUALLY changed.
                // If it was already "not_end", we don't need to bother the block below it.
                if (originalTypeId !== vineData.block_type_to_set_if_not_end) {
                    system.runTimeout(() => {
                        handleVineUpdate(
                            "chain_update",
                            block.below(),
                            vineData,
                        );
                    });
                }
            } else {
                // There is NO vine below, so this IS the end.
                if (!vineData.block_type_to_set_if_end.includes(block.typeId)) {
                    block.setType(vineData.block_type_to_set_if_end[0]);
                }
                // (End blocks don't chain down anyway, since there's no vine below them)
            }
            break;
        }
    }
}

function returnCoordInCmdForm(vec3) {
    return `${vec3.x} ${vec3.y} ${vec3.z}`;
}
export function getHoldItem(player, whichHand = "Mainhand") {
    return player.getComponent("minecraft:equippable").getEquipment(whichHand);
}

export function simulateProjectileArc(
    startPos,
    endPos,
    dimension,
    arcHeightPercentage = 0.15,
    particleId,
    callback,
) {
    const distance = Math.sqrt(
        (endPos.x - startPos.x) ** 2 +
            (endPos.y - startPos.y) ** 2 +
            (endPos.z - startPos.z) ** 2,
    );

    const controlPos = {
        x: (startPos.x + endPos.x) / 2,
        y: (startPos.y + endPos.y) / 2 + distance * arcHeightPercentage,
        z: (startPos.z + endPos.z) / 2,
    };

    // ==========================================
    // TWEAK SPEED HERE
    // n = distance traveled per tick (in blocks)
    // 20 * n = blocks traveled per second
    // ==========================================
    const n = 0.6;

    // Start t at 0
    let t = 0;

    const intervalId = system.runInterval(() => {
        // 1. If t has reached or exceeded 1, we are done.
        if (t >= 1) {
            console.warn(
                `Spawning final particle at end position: (${endPos.x.toFixed(2)}, ${endPos.y.toFixed(2)}, ${endPos.z.toFixed(2)})`,
            );
            dimension.spawnParticle(particleId, endPos);
            system.clearRun(intervalId);
            // Call the callback if provided
            if (callback) callback();
            return;
        }

        // 2. Calculate current position using standard Quadratic Bezier formula
        const u = 1 - t;
        const tt = t * t;
        const uu = u * u;

        const currentPos = {
            x: uu * startPos.x + 2 * u * t * controlPos.x + tt * endPos.x,
            y: uu * startPos.y + 2 * u * t * controlPos.y + tt * endPos.y,
            z: uu * startPos.z + 2 * u * t * controlPos.z + tt * endPos.z,
        };

        // Spawn particle
        try {
            dimension.spawnParticle(particleId, currentPos);
        } catch (error) {
            console.warn(`Failed to spawn particle: ${error}`);
        }

        // 3. Calculate the Derivative P'(t) to find the "velocity" of the curve here
        // Formula: P'(t) = 2*(1-t)*(P1 - P0) + 2*t*(P2 - P1)
        const dx =
            2 * u * (controlPos.x - startPos.x) +
            2 * t * (endPos.x - controlPos.x);
        const dy =
            2 * u * (controlPos.y - startPos.y) +
            2 * t * (endPos.y - controlPos.y);
        const dz =
            2 * u * (controlPos.z - startPos.z) +
            2 * t * (endPos.z - controlPos.z);

        // Calculate the magnitude (length) of the derivative vector
        const derivativeMag = Math.sqrt(dx * dx + dy * dy + dz * dz);

        // 4. Calculate step size dt to move exactly 'n' units
        // Prevent division by zero if the points somehow overlap
        if (derivativeMag > 0.001) {
            const dt = n / derivativeMag;
            t += dt; // Step forward exactly enough to travel 'n' units next tick
        } else {
            t = 1; // Failsafe
        }
    }, 1); // Run every 1 tick
}
