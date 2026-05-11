import { resolve } from "node:path";
import { VantResolver } from "@vant/auto-import-resolver";
import vue from "@vitejs/plugin-vue";
import Components from "unplugin-vue-components/vite";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
    plugins: [
        vue(),
        Components({
            resolvers: [
                VantResolver({
                    /* 全量样式在 main.ts 引入，避免与按需样式重复 */
                    importStyle: false,
                }),
            ],
            dts: "src/components.d.ts",
        }),
        VitePWA({
            registerType: "autoUpdate",
            manifest: {
                name: "Ledger",
                short_name: "Ledger",
                description: "Ledger",
                theme_color: "#faf6f0",
                background_color: "#faf6f0",
                display: "standalone",
                start_url: "/",
                icons: [
                    {
                        src: "/icon-192.png",
                        sizes: "192x192",
                        type: "image/png",
                    },
                    { src: "/icon.png", sizes: "512x512", type: "image/png" },
                ],
            },
            workbox: {
                globPatterns: ["**/*.{js,css,html,ico,png,svg}"],
            },
        }),
    ],
    resolve: {
        alias: {
            "@": resolve("./src"),
        },
    },
});
