//go:build !windows

package main

func isService() bool { return false }

func runService() {}

func restartServiceIfInstalled() (bool, error) { return false, nil }

func killChildrenOnExit() {}

func serviceCommand([]string) int { println("service commands are Windows only"); return 2 }
