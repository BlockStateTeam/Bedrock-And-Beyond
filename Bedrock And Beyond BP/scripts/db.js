import { world } from "@minecraft/server";

export class DynamicPropertyDatabase {
    constructor(initialNamespace = "db") {
        this.CHUNK_SIZE = 30000; // bytes (safe under 32767 limit)
        this.COUNT_KEY = initialNamespace + ":database_system_count";
        this.CHUNK_KEY_PREFIX = initialNamespace + ":database_system_chunk_";
    }

    /**
     * Save large JSON data across multiple Dynamic Properties.
     * Deletes old database before saving.
     * @param {Object} data - The data object to store
     * @returns {boolean} Success status
     */
    save(data) {
        try {
            if (typeof world?.setDynamicProperty !== "function") {
                throw new Error("Global 'world' object not available");
            }

            // Delete existing data first
            this.deleteAll();

            const jsonString = JSON.stringify(data);
            const totalSize = jsonString.length;
            const totalChunks = Math.ceil(totalSize / this.CHUNK_SIZE);

            // Store chunk count
            world.setDynamicProperty(this.COUNT_KEY, totalChunks.toString());

            // Split and store chunks
            for (let i = 0; i < totalChunks; i++) {
                const start = i * this.CHUNK_SIZE;
                const end = start + this.CHUNK_SIZE;
                const chunk = jsonString.slice(start, end);
                const chunkKey = `${this.CHUNK_KEY_PREFIX}${i}`;
                world.setDynamicProperty(chunkKey, chunk);
            }

            console.warn(
                `[DB] Saved database in ${totalChunks} chunk(s) (${totalSize} bytes).`,
            );

            return true;
        } catch (error) {
            console.error(`[DB] Error saving database:`, error);
            return false;
        }
    }

    /**
     * Load and reconstruct JSON data from stored chunks.
     * @returns {Object|null} The reconstructed data object, or null if missing.
     */
    load() {
        try {
            const countString = world.getDynamicProperty(this.COUNT_KEY);
            if (!countString) {
                console.warn(`[DB] No database found.`);
                return null;
            }

            const totalChunks = parseInt(countString, 10);
            if (isNaN(totalChunks) || totalChunks <= 0) {
                console.error(`[DB] Invalid chunk count "${countString}".`);
                return null;
            }

            let reconstructed = "";
            for (let i = 0; i < totalChunks; i++) {
                const chunkKey = `${this.CHUNK_KEY_PREFIX}${i}`;
                const chunk = world.getDynamicProperty(chunkKey);

                if (typeof chunk !== "string") {
                    console.error(`[DB] Missing or invalid chunk ${i}.`);
                    return null;
                }

                reconstructed += chunk;
            }

            return JSON.parse(reconstructed);
        } catch (error) {
            console.error(`[DB] Error loading database:`, error);
            return null;
        }
    }

    /**
     * Delete all chunks and the count property.
     * @returns {boolean} Success status
     */
    deleteAll() {
        try {
            const countString = world.getDynamicProperty(this.COUNT_KEY);
            if (!countString) return true;

            const totalChunks = parseInt(countString, 10);
            if (!isNaN(totalChunks)) {
                for (let i = 0; i < totalChunks; i++) {
                    const chunkKey = `${this.CHUNK_KEY_PREFIX}${i}`;
                    world.setDynamicProperty(chunkKey, undefined);
                }
            }

            world.setDynamicProperty(this.COUNT_KEY, undefined);
            console.warn(`[DB] Deleted database (${totalChunks || 0} chunks).`);
            return true;
        } catch (error) {
            console.error(`[DB] Error deleting database:`, error);
            return false;
        }
    }

    /**
     * Check if the database exists.
     * @returns {boolean}
     */
    exists() {
        return world.getDynamicProperty(this.COUNT_KEY) !== undefined;
    }
}
