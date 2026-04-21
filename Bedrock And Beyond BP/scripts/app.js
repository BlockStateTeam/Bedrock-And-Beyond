import {
    world,
    system,
    BlockPermutation,
    BlockVolume,
    ItemStack,
} from "@minecraft/server";
import {
    ActionFormData,
    ModalFormData,
    MessageFormData,
} from "@minecraft/server-ui";
import { DynamicPropertyDatabase } from "db.js";
import {
    handleVineUpdate,
    getHoldItem,
    simulateProjectileArc,
} from "./helper.js";
//console.warn = () => {};
let jsonDatabase, dbInstance;
system.run(() => {
    dbInstance = new DynamicPropertyDatabase("bs_bb");
    // dbInstance.deleteAll(); // Clear the database for testing, remove this line in production!
    jsonDatabase = dbInstance.load() || {};
    console.warn(JSON.stringify(jsonDatabase));
});
world.afterEvents.entitySpawn.subscribe((e) => {
    switch (e.entity.typeId) {
        case "bs_bb:pyrous_flower": {
            e.entity.lifeTime = 0;
            // bs_bb:pyrous_flower
            const groundCheck = system.runInterval(() => {
                if (!e.entity || !e.entity.isValid) {
                    system.clearRun(groundCheck);
                    return;
                }
                e.entity.lifeTime += 1;
                if (
                    (e.entity.isOnGround && e.entity.lifeTime > 3) || // 3 * 60 = 180 ticks (9 seconds) is the minimum time before the flower can spawn fire, to prevent it from doing so immediately upon spawning and potentially causing unintended consequences.
                    e.entity.lifeTime > 10
                ) {
                    // If the entity has been alive for more than 10 * 60 = 600 ticks (30 seconds), we just remove it to prevent it from existing indefinitely in case something goes wrong with the ground check.
                    // Remove it, and if the block its occupying is air, place a fire block there. Else, check for a nearby air block to place the fire block in.
                    system.clearRun(groundCheck);
                    console.warn(e.entity.lifeTime);
                    let considerLoc = e.entity.location;
                    // check if considerLoc.y is not an integer, if it isn't, we round it up
                    if (considerLoc.y % 1 !== 0) {
                        considerLoc.y = Math.ceil(considerLoc.y);
                    }
                    const blockOccupied =
                        e.entity.dimension.getBlock(considerLoc);
                    if (blockOccupied && blockOccupied.isAir) {
                        blockOccupied.setType("minecraft:fire");
                        blockOccupied.dimension.playSound(
                            "mob.ghast.fireball",
                            blockOccupied.location,
                        );
                    }
                    e.entity.removeByIntention = true;
                    e.entity.remove();
                }
            }, 60);
        }
    }
});
//"bs_bb:pyrous_vines
world.afterEvents.playerBreakBlock.subscribe((e) => {
    const blockBelow = e.block.below();
    // Check if blockBelow has "bs_bb:is_vines" component, if it does, run the vine update logic for breaking vines.
    if (blockBelow.hasComponent("bs_bb:is_vines")) {
        handleVineUpdate(
            "chain_update",
            blockBelow,
            blockBelow.getComponent("bs_bb:is_vines").customComponentParameters
                .params,
        );
    }
});
system.beforeEvents.startup.subscribe((e) => {
    // e.itemComponentRegistry.registerCustomComponent("bs_bb:knockback_stick", {
    //     onHitEntity: (e) => {
    //         e.hitEntity.addEffect("minecraft:instant_health", 20, {
    //             amplifier: 255,
    //             showParticles: true,
    //         });
    //     },
    // });
    e.blockComponentRegistry.registerCustomComponent("bs_bb:pyrous_flower", {
        onPlace: (e) => {
            // When placed, assign a growth_stage to the block based on the empty space Downwards
            // The more empty space, the lower the growth_stage, which means the further it can grow downwards.
            const currentGrowthStage =
                +e.block.permutation.getState("bs_bb:growth_stage");
            if (currentGrowthStage > 0) return;
            let growthStage = 0;
            let currentBlock = e.block;
            const runCheck = system.runInterval(() => {
                currentBlock = currentBlock.below();
                if (growthStage > 12 || !currentBlock || !currentBlock.isAir) {
                    // Cap the growth stage at 10 to prevent excessive growth
                    system.clearRun(runCheck);
                    // Check if the e.block is still bs_bb:pyrous_flower, if it isn't, we exit early to prevent accidentally changing another block's permutation.
                    if (
                        e.block.typeId !== "bs_bb:pyrous_flower" ||
                        !e.block.isValid
                    ) {
                        return;
                    }
                    const random = Math.round(Math.random() * 3);
                    e.block.setPermutation(
                        BlockPermutation.resolve("bs_bb:pyrous_flower", {
                            "bs_bb:growth_stage": Math.min(
                                14 - growthStage + random,
                                12,
                            ), // Randomize the growth stage a bit for visual variety
                        }),
                    );
                    return;
                }
                growthStage++;
            }, 2); // To reduce performance impact
        },
        onPlayerInteract: (e) => {
            console.warn(
                "Growth Stage: " +
                    e.block.permutation.getState("bs_bb:growth_stage"),
            );
            const holdItem = getHoldItem(e.player);
            if (holdItem?.typeId === "minecraft:shears") {
                e.dimension.playSound("pumpkin.carve", e.block.center());
                e.dimension.spawnEntity(
                    "bs_bb:pyrous_flower",
                    e.block.center(),
                );
                e.block.setPermutation(
                    BlockPermutation.resolve("bs_bb:pyrous_vines_end"),
                );
            }
        },
        onTick: (e) => {
            const currentGrowthStage =
                +e.block.permutation.getState("bs_bb:growth_stage") || 12;
            if (currentGrowthStage < 12 && Math.random() < 1) {
                // 30% chance each tick to do the following:
                const blockBelow = e.block.below();
                if (blockBelow && blockBelow.isAir) {
                    // Grow downwards
                    e.block.setPermutation(
                        BlockPermutation.resolve("bs_bb:pyrous_vines"),
                    );
                    const newGrowthStage = Math.min(currentGrowthStage + 1, 12);
                    blockBelow.setPermutation(
                        BlockPermutation.resolve("bs_bb:pyrous_flower", {
                            "bs_bb:growth_stage": newGrowthStage,
                        }),
                    );
                }
                return;
            }
            if (Math.random() < 0.5) {
                // If its not growing, then 50% chance to spread to a nearby block
                // 20% chance each tick to do the following:
                // Spawn a "bs_bb:pyrous_flower" entity at the block's center();
                e.dimension.spawnEntity(
                    "bs_bb:pyrous_flower",
                    e.block.center(),
                );
                e.block.setPermutation(
                    BlockPermutation.resolve("bs_bb:pyrous_vines_end"),
                );
            }
        },
    });
    e.blockComponentRegistry.registerCustomComponent(
        "bs_bb:block_type_change",
        {
            onTick: (e, arg) => {
                let chance = arg.params.chance || 0; // If there's no chance parameter, default to 0;
                if (Math.random() > chance) return; // Chance check, if the random number is greater than the chance, we exit early and do nothing.
                e.block.setType(arg.params.block_type_to_set);
            },
        },
    );
    e.blockComponentRegistry.registerCustomComponent("bs_bb:is_vines", {
        onBreak: (e, arg) => {
            handleVineUpdate("break", e.block, arg.params);
        },
        onPlace: (e, arg) => {
            handleVineUpdate("place", e.block, arg.params);
        },
    });
    // e.customCommandRegistry.registerCommand(
    //     {
    //         name: "scrollfight:setting",
    //         description: "Setting Command",
    //         permissionLevel: 0, // Anyone can use
    //     },
    //     (origin) => {
    //         const sourceEntity = origin.sourceEntity;
    //         if (!sourceEntity || sourceEntity?.typeId !== "minecraft:player")
    //             return;
    //         const currentSetting = {
    //             enableMusic:
    //                 jsonDatabase[sourceEntity.name].enableMusic || true,
    //             musicVolume: jsonDatabase[sourceEntity.name].musicVolume || 2,
    //         };
    //         system.run(() => {
    //             new ModalFormData()
    //                 .title("Setting")
    //                 .label(" ")
    //                 .toggle("Enable Music", {
    //                     defaultValue: currentSetting.enableMusic,
    //                 })
    //                 .divider()
    //                 .slider("Music Volume", 1, 5, {
    //                     valueStep: 1,
    //                     defaultValue: currentSetting.musicVolume,
    //                 })
    //                 .show(sourceEntity)
    //                 .then((response) => {
    //                     if (response.canceled) return;
    //                     jsonDatabase[sourceEntity.name].enableMusic =
    //                         response.formValues[1];
    //                     jsonDatabase[sourceEntity.name].musicVolume =
    //                         response.formValues[3];
    //                     dbInstance.save(jsonDatabase);
    //                 });
    //         });
    //         return {
    //             status: 0, // Success
    //         };
    //     },
    // );
});

world.beforeEvents.entityRemove.subscribe((e) => {
    const removedEntity = e.removedEntity;
    switch (removedEntity.typeId) {
        case "bs_bb:pyrous_flower": {
            if (removedEntity.removeByIntention) {
                return; // If the entity is being removed intentionally by our code, we skip the logic below to prevent accidentally spawning fire when we don't want to.
            }
            // Removed by something else;
            const nearestPyrousFrog = removedEntity.dimension.getEntities({
                location: removedEntity.location,
                maxDistance: 3,
                type: "bs_bb:pyrous_frog",
            })[0];
            if (nearestPyrousFrog && nearestPyrousFrog.isValid) {
                const previousState =
                    +nearestPyrousFrog.getProperty("bs_bb:pyrous_state") || 0;
                if (previousState < 3) {
                    system.run(() => {
                        nearestPyrousFrog.setProperty(
                            "bs_bb:pyrous_state",
                            previousState + 1,
                        );
                    });
                }
                // Set the property of the frog by +1
            }
        }
    }
});
system.afterEvents.scriptEventReceive.subscribe(
    ({ id, sourceEntity }) => {
        if (id === "bs_bb:zombie_wanted") {
            // Check if the pyrous_state is 3; else return;
            if (sourceEntity.getProperty("bs_bb:pyrous_state") !== 3) return;
            // Get up to 4 closest zombies within 10 blocks
            const nearestZombies = sourceEntity.dimension.getEntities({
                location: sourceEntity.location,
                maxDistance: 10,
                families: ["zombie"],
                closest: 4, // Caps the array at 4 and sorts by nearest distance automatically
            });

            if (nearestZombies.length > 0) {
                const primaryTarget = nearestZombies[0];
                let dyRot = 0;
                if (primaryTarget && primaryTarget.isValid) {
                    dyRot =
                        Math.atan2(
                            primaryTarget.location.x - sourceEntity.location.x,
                            primaryTarget.location.z - sourceEntity.location.z,
                        ) *
                        (180 / Math.PI);
                    console.warn("Calculated rotation: " + dyRot);
                    sourceEntity.setRotation({ x: 0, y: dyRot });
                }

                system.runTimeout(() => {
                    if (!sourceEntity || !sourceEntity.isValid) return;
                    sourceEntity.setRotation({ x: 0, y: dyRot });
                    sourceEntity.playAnimation(
                        "animation.bs_bb.pyrous_frog.launch_pyrous_spot",
                    );
                    sourceEntity.setProperty("bs_bb:pyrous_state", 0);
                    for (const zombie of nearestZombies) {
                        if (!zombie || !zombie.isValid) continue;
                        simulateProjectileArc(
                            sourceEntity.location,
                            zombie.location,
                            sourceEntity.dimension,
                            0.3,
                            "minecraft:mobflame_single",
                            () => {
                                if (!zombie || !zombie.isValid) return;
                                zombie.setOnFire(9999999, false);
                            },
                        );
                    }
                }, 40); // Delay for rotation
            }
        }
    },
    { namespaces: ["bs_bb"] },
);
