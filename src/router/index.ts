import { createMemoryHistory, createRouter } from "vue-router";

const TOKEN_KEY = "gitee_user_token";
const BOOK_KEY = "selected_book_id";

const router = createRouter({
    history: createMemoryHistory(),
    routes: [
        {
            path: "/login",
            name: "login",
            component: () => import("../pages/login/Login.vue"),
        },
        {
            path: "/book-select",
            name: "book-select",
            component: () => import("../pages/book-select/BookSelect.vue"),
        },
        {
            path: "/",
            component: () => import("../layouts/MainLayout.vue"),
            children: [
                {
                    path: "",
                    name: "home",
                    component: () => import("../pages/home/Home.vue"),
                },
                {
                    path: "stat",
                    name: "stat",
                    component: () => import("../pages/stat/Stat.vue"),
                },
                {
                    path: "assets",
                    name: "assets",
                    component: () => import("../pages/assets/Assets.vue"),
                },
                {
                    path: "profile",
                    name: "profile",
                    component: () => import("../pages/profile/Profile.vue"),
                },
                {
                    path: "profile/categories/:kind",
                    name: "profile-categories",
                    component: () =>
                        import(
                            "../pages/profile/categories/CategoryManage.vue"
                        ),
                },
            ],
        },
    ],
});

router.beforeEach((to) => {
    const hasToken = !!localStorage.getItem(TOKEN_KEY);
    const hasBook = !!localStorage.getItem(BOOK_KEY);

    if (!hasToken && to.name !== "login") {
        return { name: "login" };
    }
    if (hasToken && to.name === "login") {
        return { name: hasBook ? "home" : "book-select" };
    }
    if (hasToken && !hasBook && to.name !== "book-select") {
        return { name: "book-select" };
    }
});

export default router;
