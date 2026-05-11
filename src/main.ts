import { Locale } from "vant";
import zhCN from "vant/es/locale/lang/zh-CN";
import { createApp } from "vue";
import App from "./App.vue";
import router from "./router";
/* 全局样式先于 Vant，避免覆盖顺序异常 */
import "./index.css";
import "vant/lib/index.css";
import "./cent-vant-theme.css";

Locale.use("zh-CN", zhCN);

const app = createApp(App);
app.use(router);
app.mount("#app");
