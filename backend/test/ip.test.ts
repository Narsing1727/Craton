import { test } from "node:test";
import assert from "node:assert/strict";
import { addressInList } from "../src/api/ip.ts";

test("single addresses match exactly, including an IPv4 address seen through a dual-stack socket", () => {
  const list = ["127.0.0.1", "::1"];
  assert.equal(addressInList("127.0.0.1", list), true);
  assert.equal(addressInList("::ffff:127.0.0.1", list), true);
  assert.equal(addressInList("::1", list), true);
  assert.equal(addressInList("127.0.0.2", list), false);
  assert.equal(addressInList("::2", list), false);
});

test("IPv4 ranges in CIDR form match every address inside and none outside", () => {
  const list = ["10.0.0.0/8", "172.16.0.0/12", "192.168.1.0/24"];
  for (const a of ["10.1.2.3", "10.255.255.255", "172.16.0.1", "172.31.255.254", "192.168.1.200", "::ffff:10.9.9.9"]) assert.equal(addressInList(a, list), true, a);
  for (const a of ["11.0.0.1", "172.32.0.1", "172.15.255.255", "192.168.2.1", "8.8.8.8", "::1"]) assert.equal(addressInList(a, list), false, a);
});

test("/0 trusts everything over IPv4, /32 one address; nonsense entries trust nothing", () => {
  assert.equal(addressInList("203.0.113.9", ["0.0.0.0/0"]), true);
  assert.equal(addressInList("203.0.113.9", ["203.0.113.9/32"]), true);
  assert.equal(addressInList("203.0.113.10", ["203.0.113.9/32"]), false);
  for (const bad of ["10.0.0.0/33", "10.0.0.0/-1", "10.0.0/8", "300.1.1.1/8", "abc/8", "10.0.0.0/x", ""]) assert.equal(addressInList("10.0.0.1", [bad]), false, bad);
});
