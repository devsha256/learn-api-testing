package com.devsha256.postman;

import com.devsha256.postman.service.PostmanCollectionService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.CommandLineRunner;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * Main application class for Postman Manager CLI tool
 * Implements CommandLineRunner to execute commands on startup
 */
@SpringBootApplication
@Slf4j
public class PostmanManagerApplication implements CommandLineRunner {

    @Autowired
    private PostmanCollectionService collectionService;

    public static void main(String[] args) {
        SpringApplication.run(PostmanManagerApplication.class, args);
    }

    @Override
    public void run(String... args) throws Exception {
        log.info("==========================================================");
        log.info("  Postman Manager - CLI Application Started");
        log.info("==========================================================");

        if (args.length == 0) {
            printUsage();
            return;
        }

        String command = args[0].toLowerCase();

        try {
            switch (command) {
                case "split":
                    if (args.length < 3) {
                        log.error("❌ Insufficient arguments for 'split' command");
                        log.error("Usage: split <source-file> <output-directory>");
                        return;
                    }
                    log.info("📂 Executing SPLIT command...");
                    collectionService.splitCollectionIntoIndividualRequests(args[1], args[2]);
                    log.info("✅ Split operation completed successfully!");
                    break;

                case "merge":
                    if (args.length < 3) {
                        log.error("❌ Insufficient arguments for 'merge' command");
                        log.error("Usage: merge <source-folder> <output-file>");
                        return;
                    }
                    log.info("🔗 Executing MERGE command...");
                    collectionService.mergeCollectionsFromFolder(args[1], args[2]);
                    log.info("✅ Merge operation completed successfully!");
                    break;

                case "help":
                case "-h":
                case "--help":
                    printUsage();
                    break;

                default:
                    log.error("❌ Unknown command: {}", command);
                    printUsage();
            }
        } catch (Exception e) {
            log.error("❌ Error executing command: {}", e.getMessage());
            log.debug("Stack trace:", e);
            System.exit(1);
        }

        log.info("==========================================================");
    }

    private void printUsage() {
        System.out.println("\n╔════════════════════════════════════════════════════════════════╗");
        System.out.println("║          POSTMAN MANAGER - CLI USAGE GUIDE                     ║");
        System.out.println("╚════════════════════════════════════════════════════════════════╝");
        System.out.println();
        System.out.println("📌 AVAILABLE COMMANDS:");
        System.out.println("─────────────────────────────────────────────────────────────────");
        System.out.println();
        System.out.println("1️⃣  SPLIT - Split collection into individual request collections");
        System.out.println("   Syntax:");
        System.out.println("     java -jar postman-manager.jar split <source-file.json> <output-directory>");
        System.out.println();
        System.out.println("   Example:");
        System.out.println("     java -jar postman-manager.jar split my-collection.json ./output");
        System.out.println();
        System.out.println("─────────────────────────────────────────────────────────────────");
        System.out.println();
        System.out.println("2️⃣  MERGE - Merge multiple collections into one");
        System.out.println("   Syntax:");
        System.out.println("     java -jar postman-manager.jar merge <source-folder> <output-file.json>");
        System.out.println();
        System.out.println("   Example:");
        System.out.println("     java -jar postman-manager.jar merge ./collections merged-collection.json");
        System.out.println();
        System.out.println("─────────────────────────────────────────────────────────────────");
        System.out.println();
        System.out.println("3️⃣  HELP - Display this usage guide");
        System.out.println("   Syntax:");
        System.out.println("     java -jar postman-manager.jar help");
        System.out.println();
        System.out.println("═════════════════════════════════════════════════════════════════");
        System.out.println();
    }
}
