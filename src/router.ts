import { createRouter, createWebHistory } from 'vue-router'

const routeStub = { template: '<span />' }

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'overview', component: routeStub },
    { path: '/login', name: 'login', component: routeStub },
    { path: '/proxies', name: 'proxies', component: routeStub },
    { path: '/proxies/new', name: 'proxy-new', component: routeStub },
    { path: '/proxies/:id/edit', name: 'proxy-edit', component: routeStub },
    { path: '/locations', name: 'locations', component: routeStub },
    { path: '/activity', name: 'activity', component: routeStub },
    { path: '/billing', name: 'billing', component: routeStub },
    { path: '/users', name: 'users', component: routeStub },
    { path: '/books', name: 'books', component: routeStub },
    { path: '/users/:id', name: 'user-detail', component: routeStub },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})
